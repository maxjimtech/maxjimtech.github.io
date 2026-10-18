"""RD065 family generator. Run with the bundled FreeCAD Python, not system Python."""
import argparse, csv, datetime, json, math, pathlib, shutil, subprocess, sys, time, traceback
import FreeCAD as A, Part, Sketcher, TechDraw
import datetime as task_datetime
from requirements import validate
from envelope import sections
from native_features import Polygon, RevolvedRing, RobustCut, SplineSection, NativeEdgeChamfer, CylindricalSweepCut, PoseChamferCut, ActualArcChamfer
ROOT=pathlib.Path(__file__).resolve().parent

def log(s):print(s,flush=True)
def healthy(o):
    if o.Shape.isNull():raise RuntimeError('Null solid: '+o.Name)
    if not o.Shape.isValid() or len(o.Shape.Solids)!=1:
        raise RuntimeError('Invalid or disconnected solid: '+o.Name+' valid='+str(o.Shape.isValid())+' solids='+str(len(o.Shape.Solids))+' volumes='+str([s.Volume for s in o.Shape.Solids]))

def run(c, output=None):
    validate(c);stamp=task_datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    out=pathlib.Path(output) if output else ROOT/'output'/(c['project']+'_'+stamp)
    if out.exists() and any(out.iterdir()):raise ValueError('Output directory must be new or empty; previous revisions are preserved.')
    out.mkdir(parents=True,exist_ok=True)
    for sub in ['STEP','DXF']: (out/sub).mkdir()
    (out/'requirements.json').write_text(json.dumps(c,ensure_ascii=False,indent=2),encoding='utf-8')
    doc=A.newDocument(c['project']); ledger=[];dimensions=[];warnings=[];boolean_repairs=[]
    try:
        params=doc.addObject('Spreadsheet::Sheet','Requirements')
        for row,(k,v) in enumerate(c.items(),1):
            params.set('A'+str(row),k);params.set('B'+str(row),str(v))
            if isinstance(v,(int,float)) and not isinstance(v,bool):params.setAlias('B'+str(row),k)
        params.setColumnWidth('A',250)
        def hide(o):o.Visibility=False
        def cylinder(name,r,h,z=0,x=0,y=0):
            o=doc.addObject('Part::Cylinder',name);o.Radius=r;o.Height=h;o.Placement.Base=A.Vector(x,y,z);return o
        def cut(name,base,tool):
            o=doc.addObject('Part::Cut',name);o.Base=base;o.Tool=tool;doc.recompute()
            try:healthy(o)
            except RuntimeError as error:
                log(str(error));o.Refine=True;doc.recompute()
                try:
                    healthy(o);boolean_repairs.append({'feature':name,'method':'native_refine','tolerance_mm':0})
                except RuntimeError:
                    # Never discard disconnected fragments or accept an invalid body.
                    doc.removeObject(o.Name)
                    for tolerance in [1e-6,1e-5,1e-4]:
                        o=doc.addObject('Part::FeaturePython',name);RobustCut(o,base,tool,tolerance);doc.recompute()
                        log('Boolean retry '+name+' tolerance_mm='+str(tolerance))
                        try:healthy(o)
                        except RuntimeError as failure:
                            log(str(failure));doc.removeObject(o.Name);continue
                        if not 0<o.Shape.Volume<base.Shape.Volume:
                            doc.removeObject(o.Name);continue
                        boolean_repairs.append({'feature':name,'method':'linked_fuzzy_cut_refined','tolerance_mm':tolerance});break
                    else:raise RuntimeError('No valid single-solid boolean result: '+name)
            healthy(o);hide(base);hide(tool);return o
        def union(name,items):
            o=doc.addObject('Part::MultiFuse',name);o.Shapes=items;doc.recompute();healthy(o)
            for it in items:hide(it)
            return o
        def compound(name,items):
            o=doc.addObject('Part::Compound',name);o.Links=items;doc.recompute()
            for it in items:hide(it)
            return o
        # Native editable Part primitives; no imported STEP body is used.
        W=c['cam_width_mm'];cam0=71;cam1=cam0+W;centre=(cam0+cam1)/2;L=c['shaft_length_mm']
        segments=[('LeftEnd',18,0,10),('M20ThreadBlank',20,10,25),('LeftRelief',18.5,25,27),('LeftJournal',20,27,55),('LeftShoulderRelief',19.6,55,57),('LeftShoulder',25,57,cam0),('CamStock',c['cam_od_mm'],cam0,cam1),('RightShoulder',25,cam1,cam1+18),('RightRelief',19.6,cam1+18,cam1+20),('RightJournal',20,cam1+20,L)]
        objs=[cylinder(n,diam/2,b-a,a) for n,diam,a,b in segments]
        doc.CamStock.setExpression('Radius','Requirements.cam_od_mm / 2');doc.CamStock.setExpression('Height','Requirements.cam_width_mm')
        shaft=union('ShaftBlank',objs)
        bores=[cylinder('RightM6TapDrill',2.5,16,L-16),cylinder('RightCounterbore',3.25,5,L-5),cylinder('LeftCentreDrill',1.5,6)]
        cones=[]
        for name,r1,r2,h,z in [('LeftCentreCone',3.5,1.5,2/math.tan(math.pi/6),0),('RightCentreCone',3.25,4,.75/math.tan(math.pi/6),L-.75/math.tan(math.pi/6))]:
            o=doc.addObject('Part::Cone',name);o.Radius1=r1;o.Radius2=r2;o.Height=h;o.Placement.Base.z=z;cones.append(o)
        shaft=cut('ShaftCentreHoles',shaft,compound('CentreHoleTools',bores+cones))
        R=c['roller_pcd_mm']/2;N=c['ratio'];ad=c['axis_distance_mm'];rr=c['roller_od_mm']/2+c['clearance_mm'];rad=c['cam_od_mm']/2;C=c['chamfer_mm']
        span=max(.85,math.asin(min(.9,(W/2+rr+3)/R)));count=max(409,int(2*span*N*12)|1)
        betas=[-span+2*span*i/(count-1) for i in range(count)]
        for i in range(N):
            beta=math.remainder(math.pi/2+2*math.pi*i/N,2*math.pi)
            if -span<=beta<=span:betas.append(beta)
        betas=sorted(set(round(beta,14) for beta in betas));poses=[]
        turn=A.Rotation(A.Vector(0,0,1),A.Vector(1,0,0))
        for i,beta in enumerate(betas):
            spin=A.Rotation(A.Vector(0,0,1),-math.degrees(N*beta))
            tool=doc.addObject('Part::Cylinder','FiniteCutterPose_%04d'%i);tool.Radius=rr;tool.Height=rad+1-c['cam_root_mm']/2
            tool.Placement=A.Placement(spin.multVec(A.Vector(c['cam_root_mm']/2,ad-R*math.cos(beta),centre+R*math.sin(beta))),spin.multiply(turn))
            hide(tool);poses.append(tool)
        doc.recompute();log('Analytic finite-cylinder cutter poses: '+str(len(poses)))
        base=shaft;shaft=doc.addObject('Part::FeaturePython','CNCFiniteCylinderSweep');CylindricalSweepCut(shaft,base,poses)
        doc.recompute();healthy(shaft);hide(base)
        log('Finite-cylinder CNC removed_mm3='+str(base.Shape.Volume-shaft.Shape.Volume))
        ledger.append({'feature':shaft.Name,'valid':True,'volume_mm3':shaft.Shape.Volume,'method':'analytic finite-cylinder pose union','poses':len(poses)})
        stride=0;profile_error=0.;profiles=[]
        before_path=out.parent/'pre_chamfer.step';shaft.Shape.exportStep(str(before_path))
        before=Part.Shape();before.read(str(before_path))
        log('Pre-chamfer STEP '+json.dumps({'valid':before.isValid(),'solids':len(before.Solids),'closed':all(s.isClosed() for s in before.Solids),'native_volume':shaft.Shape.Volume,'step_volume':before.Volume}))
        doc.saveAs(str(out.parent/'PRE_CHAMFER_DEBUG.FCStd'))
        if not before.isValid() or len(before.Solids)!=1 or not before.Solids[0].isClosed() or abs(before.Volume-shaft.Shape.Volume)>max(.001,shaft.Shape.Volume*1e-5):
            raise RuntimeError('Pre-chamfer STEP validation failed')
        # User explicitly authorizes omitting the remaining groove-edge chamfer.
        # Retain the validated CNC groove; do not claim an unbuilt edge treatment.
        log('Cam groove outer-edge chamfer omitted by user authorization')
        warnings.append('Cam outer groove and end edges are not chamfered; omission explicitly authorized for this sample version.')
        for name,z,sg in [('LeftShaftEndC',0,1)]:
            r=rad if name.startswith('Cam') else 9;v=C if name.startswith('Cam') else 1
            points=[A.Vector(r-v,0,z),A.Vector(r+.2,0,z),A.Vector(r+.2,0,z+sg*(v+.2))]
            tool=doc.addObject('Part::FeaturePython',name+'Tool');RevolvedRing(tool,points);doc.recompute();shaft=cut(name,shaft,tool)
        shaft.Label='1A Cam shaft — constant velocity CNC groove'
        shaft.addProperty('App::PropertyString','ThreadNotes');shaft.ThreadNotes='M20x1.5 external blank; M6x1 tapped drill. V1 uses conventional thread notes, not physical thread teeth.'
        # Native ring, hole tools and linked booleans for the plate.
        plate=cylinder('PlateStock',c['plate_od_mm']/2,c['plate_thickness_mm']);plate.setExpression('Radius','Requirements.plate_od_mm / 2');plate.setExpression('Height','Requirements.plate_thickness_mm')
        plate=cut('PlateCentreBore',plate,cylinder('CentreBoreTool',c['plate_bore_mm']/2,c['plate_thickness_mm']))
        groups=[('FollowerHoles',c['roller_count'],c['roller_pcd_mm'],0,c['roller_bore_mm']),('MountClearance',10,85,90,6.5),('M5TapDrills',10,95,0,4.2),('Auxiliary',5,136,9,6),('Dowel',2,110,-9,6)]
        for name,count,pcd,phase,dia in groups:
            tools=[]
            for i in range(count):
                a=math.radians(phase)+2*math.pi*i/count if name!='Dowel' else math.radians(phase)+i*math.pi
                tools.append(cylinder(name+'_%02d'%i,dia/2,c['plate_thickness_mm'],x=pcd/2*math.cos(a),y=pcd/2*math.sin(a)))
            plate=cut(name+'Cut',plate,compound(name+'Tools',tools))
        counterbores=[]
        for i in range(10):
            a=2*math.pi*i/10;x=47.5*math.cos(a);y=47.5*math.sin(a)
            counterbores += [cylinder('M5BackRelief_%02d'%i,3,1.5,x=x,y=y),cylinder('M5FrontRelief_%02d'%i,3,1.5,c['plate_thickness_mm']-1.5,x,y)]
        plate=cut('M5EndReliefCut',plate,compound('M5EndReliefTools',counterbores))
        sinks=[]
        for i in range(c['roller_count']):
            a=2*math.pi*i/c['roller_count'];o=doc.addObject('Part::Cone','FollowerBackCountersink_%02d'%i);o.Radius1=5.5;o.Radius2=c['roller_bore_mm']/2;o.Height=max(.1,5.5-c['roller_bore_mm']/2);o.Placement.Base=A.Vector(R*math.cos(a),R*math.sin(a),0);sinks.append(o)
        plate=cut('FollowerBackCountersinkCut',plate,compound('FollowerBackCountersinkTools',sinks))
        for name,z,sg,amount in [('PlateBackC',0,1,1.5),('PlateFrontC',c['plate_thickness_mm'],-1,1.2)]:
            r=c['plate_od_mm']/2;tool=doc.addObject('Part::FeaturePython',name+'Tool');RevolvedRing(tool,[A.Vector(r-amount,0,z),A.Vector(r+.2,0,z),A.Vector(r+.2,0,z+sg*(amount+.2))]);doc.recompute();plate=cut(name,plate,tool)
        plate.Label='2A Roller plate — hole patterns'
        # External roller envelope; bearing internals remain unspecified.
        T=c['roller_total_length_mm'];ww=c['roller_working_width_mm'];shoulderZ=T-1-ww-1.65;workingZ=T-1-ww
        roller=union('RollerEnvelope',[cylinder('RollerStud',4,shoulderZ),cylinder('RollerShoulder',5,1.65,shoulderZ),cylinder('RollerWorkingOD',c['roller_od_mm']/2,ww,workingZ),cylinder('RollerTip',4,1,T-1)])
        doc.RollerWorkingOD.setExpression('Radius','Requirements.roller_od_mm / 2');doc.RollerWorkingOD.setExpression('Height','Requirements.roller_working_width_mm');roller.Label='Roller OD envelope — internals unspecified'
        assembly=doc.addObject('App::DocumentObjectGroup','Assembly')
        links=[]
        def link(obj,name,placement):
            o=doc.addObject('App::Link',name);o.setLink(obj);o.LinkPlacement=placement;assembly.addObject(o);links.append(o);return o
        link(plate,'PlateOccurrence',A.Placement())
        link(shaft,'CamOccurrence',A.Placement(A.Vector(-centre,-ad,c['plate_back_to_cam_axis_mm']),A.Rotation(A.Vector(0,1,0),90)))
        for i in range(c['roller_count']):
            a=2*math.pi*i/c['roller_count'];link(roller,'RollerOccurrence_%02d'%i,A.Placement(A.Vector(R*math.cos(a),R*math.sin(a),0),A.Rotation()))
        # Keep only assembly links visible when opened.
        for o in [shaft,plate,roller]:hide(o)
        doc.recompute()
        step_checks=[]
        def export_verified(shape,path,expected):
            sources=out/'verification_sources';sources.mkdir(exist_ok=True)
            shape.exportBrep(str(sources/(path.stem+'.brep')))
            shape.exportStep(str(path));restored=Part.Shape();restored.read(str(path))
            row={'file':path.name,'valid':restored.isValid(),'solids':len(restored.Solids),'closed':all(s.isClosed() for s in restored.Solids),'source_volume_mm3':shape.Volume,'step_volume_mm3':restored.Volume}
            step_checks.append(row);log('Early STEP round-trip '+json.dumps(row))
            (out/'step_roundtrip.json').write_text(json.dumps(step_checks,indent=2))
            if not row['valid'] or row['solids']!=expected or not row['closed'] or abs(row['source_volume_mm3']-row['step_volume_mm3'])>max(.001,abs(shape.Volume)*1e-5):
                raise RuntimeError('STEP topology or volume mismatch: '+path.name)
        for name,obj in [('CamShaft',shaft),('RollerPlate',plate),('Roller',roller)]:
            healthy(obj);export_verified(obj.Shape,out/'STEP'/(name+'.step'),1)
        world=[]
        for o in links:
            sh=o.LinkedObject.Shape.copy();sh.Placement=o.LinkPlacement.multiply(sh.Placement);world.append(sh)
        assemblyShape=Part.makeCompound(world);export_verified(assemblyShape,out/'STEP/Assembly.step',c['roller_count']+2)
        checks={'native_parts':[{ 'part':o.Name,'valid':o.Shape.isValid(),'solids':len(o.Shape.Solids),'volume_mm3':o.Shape.Volume} for o in [shaft,plate,roller]],'assembly_occurrences':len(links),'assembly_solids':len(assemblyShape.Solids),'precision_requirement':'none','thread_geometry':'conventional notes and tap drills; physical teeth not modeled','machining_assumptions':['nominal cutter OD equals roller OD','roller axial segmentation inferred','auxiliary plate hole layouts fixed to RD065'],'curve_generation':'finite cylinder envelope; cached sections only for exact RD065 basis'}
        collisions=[]
        if c['check_interference']:
            for i,s in enumerate(world):
                for j,t in enumerate(world[i+1:],i+1):
                    if not s.BoundBox.intersect(t.BoundBox):continue
                    volume=s.common(t).Volume
                    if volume>1e-5:collisions.append({'a':links[i].Name,'b':links[j].Name,'volume_mm3':volume})
            log('Interference pairs: '+str(len(collisions)))
        checks['interference_tested']=c['check_interference'];checks['interferences']=collisions
        checks['cam_surface_method']='analytic finite-cylinder tool poses; finite angular sampling; continuous curvature not certified'
        checks['radial_profile_stride']=None;checks['radial_sample_deviation_mm']=None;checks['radial_spline_polyline_deviation_mm']=None
        checks['step_geometric_acceptance_mm']=.01
        checks['cam_groove_edge_chamfer_status']='OMITTED_USER_AUTHORIZED'
        checks['cam_end_edge_chamfer_status']='OMITTED_USER_AUTHORIZED'
        checks['warnings']=warnings
        doc.saveAs(str(out/'NativeGeometry.FCStd'))
        log('Building native TechDraw pages')
        from drawings import build_pages
        pages,dimensions=build_pages(doc,c,shaft,plate,roller,links,out)
        doc.recompute();fc=out/(c['project']+'.FCStd');doc.saveAs(str(fc))
        from dxf_finish import export_page
        for p in pages:export_page(p,out/'DXF'/(p.Name+'.dxf'),c['project'])
        # Reopen serialized native document, verify object graph and actual STEP files.
        part_names=[shaft.Name,plate.Name,roller.Name]
        saved_volumes={name:doc.getObject(name).Shape.Volume for name in part_names}
        A.closeDocument(doc.Name);doc=A.openDocument(str(fc));doc.recompute()
        checks['reopen_native_solids']=[len(doc.getObject(name).Shape.Solids) for name in part_names]
        for name in part_names:healthy(doc.getObject(name))
        checks['reopen_native_volume_checks']=[]
        for name in part_names:
            restored_volume=doc.getObject(name).Shape.Volume
            if abs(restored_volume-saved_volumes[name])>max(.001,abs(saved_volumes[name])*1e-5):raise RuntimeError('Native reopen volume mismatch: '+name)
            checks['reopen_native_volume_checks'].append({'part':name,'saved_volume_mm3':saved_volumes[name],'reopened_volume_mm3':restored_volume})
        checks['reopen_native_valid']=[doc.getObject(name).Shape.isValid() for name in part_names]
        checks['drawing_pages']=len(pages);checks['native_dimensions']=len(dimensions)
        checks['step_reopen']=step_checks
        # Optional DWG only when explicitly configured; no false renamed DXF.
        checks['dwg_status']='not_requested'
        if c.get('dwg_converter'):
            converter=pathlib.Path(c['dwg_converter']);dwg=out/'DWG';dwg.mkdir()
            if not converter.is_file():raise ValueError('DWG converter executable missing.')
            subprocess.run([str(converter),str(out/'DXF'),str(dwg),'ACAD2018','DWG','0','1','*.dxf'],check=True)
            checks['dwg_status']='converted_unverified'
        elif c.get('require_dwg'):raise RuntimeError('DWG requested but no converter configured; DXF/STEP/FCStd were preserved.')
        checks['status']='REVIEW_MODEL_INTERFERENCE_FOUND' if collisions else 'GENERATED_REVIEW_MODEL'
        checks['drawing_status']='TechDraw linked views and principal native dimensions; full production dimension coverage not certified'
        checks['feature_ledger']=ledger
        checks['boolean_repairs']=boolean_repairs
        (out/'validation.json').write_text(json.dumps(checks,indent=2))
        (out/'dimension_ledger.json').write_text(json.dumps(dimensions,indent=2))
        with (out/'BOM.csv').open('w',newline='',encoding='utf-8-sig') as f:
            w=csv.writer(f);w.writerow(['Part','Quantity','Material','Notes']);w.writerows([['CamShaft',1,c['material'],'Conventional thread representation'],['RollerPlate',1,c['material'],'Fixed auxiliary hole patterns'],['Roller',c['roller_count'],'UNSPECIFIED','External envelope only']])
        log('OUTPUT '+str(out));return out
    except Exception:
        (out/'failure.txt').write_text(traceback.format_exc(),encoding='utf-8')
        try:
            if doc.Name in A.listDocuments():doc.saveAs(str(out/'FAILED_DEBUG_NOT_DELIVERY.FCStd'))
        except Exception:pass
        raise
    finally:
        try:
            if doc.Name in A.listDocuments():A.closeDocument(doc.Name)
        except Exception:pass

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--config',default=str(ROOT/'config.json'));ap.add_argument('--output');args=ap.parse_args();run(json.loads(pathlib.Path(args.config).read_text(encoding='utf-8-sig')),args.output)

