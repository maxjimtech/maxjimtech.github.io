"""RD065 family generator. Run with the bundled FreeCAD Python, not system Python."""
import argparse, csv, datetime, json, math, pathlib, shutil, subprocess, sys, time, traceback
import FreeCAD as A, Part, Sketcher, TechDraw
import datetime as task_datetime
from requirements import validate
from envelope import sections
from native_features import Polygon, RevolvedRing, RobustCut
ROOT=pathlib.Path(__file__).resolve().parent

def log(s):print(s,flush=True)
def healthy(o):
    if o.Shape.isNull() or not o.Shape.isValid() or len(o.Shape.Solids)!=1:
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
        log('Preparing continuous CNC envelope sections')
        ss=sections(c,log);(out/'cutter_sections.json').write_text(json.dumps(ss))
        profiles=[]
        for i,s in enumerate(ss):
            a=s['alpha'];pts=[A.Vector(r*math.cos(a),r*math.sin(a),z) for r,z in s['lower']+list(reversed(s['upper']))]
            o=doc.addObject('Part::FeaturePython','GrooveSection_%04d'%i);Polygon(o,pts);hide(o);profiles.append(o)
        doc.recompute()
        for start in range(0,len(ss)-1,30):
            tool=doc.addObject('Part::Loft','CNCGrooveLoft_%03d'%start);tool.Sections=profiles[start:min(start+31,len(ss))];tool.Solid=True;tool.Ruled=False;tool.Closed=False;tool.MaxDegree=8
            doc.recompute();healthy(tool);shaft=cut('CNCGrooveCut_%03d'%start,shaft,tool);ledger.append({'feature':shaft.Name,'valid':True,'volume_mm3':shaft.Shape.Volume});log('Native groove cut %d/%d'%(start//30+1,math.ceil((len(ss)-1)/30)))
        # Continuous edge C cut: same conjugate contact formula as groove generation.
        R=c['roller_pcd_mm']/2;N=c['ratio'];ad=c['axis_distance_mm'];rr=c['roller_od_mm']/2+c['clearance_mm'];rad=c['cam_od_mm']/2;C=c['chamfer_mm']
        def edge(alpha,r,sign):
            b=-alpha/N
            for _ in range(45):
                x=r*math.cos(alpha+N*b);vy=R*math.sin(b)-N*x;vz=R*math.cos(b);v=math.hypot(vy,vz);cu=sign*vz/v;su=-sign*vy/v;y=ad-R*math.cos(b)+rr*cu;t=math.asin(max(-.999999,min(.999999,y/r)));b=(t-alpha)/N
            x=r*math.cos(alpha+N*b);vy=R*math.sin(b)-N*x;vz=R*math.cos(b);v=math.hypot(vy,vz);cu=sign*vz/v;su=-sign*vy/v;z=centre+R*math.sin(b)+rr*su
            return A.Vector(r*math.cos(alpha),r*math.sin(alpha),z),A.Vector(-math.sin(N*b)*cu,-math.cos(N*b)*cu,-su)
        for sign,name in [(-1,'Lower'),(1,'Upper')]:
            pp=[];span=max(abs(s['alpha']) for s in ss);count=math.ceil(2*span/.05)
            for i in range(count+1):
                a=-span+2*span*i/count;e,n=edge(a,rad,sign)
                if not cam0-3<e.z<cam1+3:continue
                er=A.Vector(math.cos(a),math.sin(a),0);dz=(edge(a+1e-5,rad,sign)[0].z-edge(a-1e-5,rad,sign)[0].z)/2e-5;den=math.hypot(rad,dz);da=-sign*C*dz/(rad*den)
                cf=A.Vector(rad*math.cos(a+da),rad*math.sin(a+da),e.z+sign*C*rad/den)
                vf=-er+n*n.dot(er);vf.normalize();f=e+vf*C;af=a+math.atan2(math.sin(math.atan2(f.y,f.x)-a),math.cos(math.atan2(f.y,f.x)-a));f=edge(af,math.hypot(f.x,f.y),sign)[0]
                o=doc.addObject('Part::FeaturePython',name+'CSection_%04d'%i);Polygon(o,[cf,f,e+er+n]);hide(o);pp.append(o)
            if len(pp)<4:raise ValueError('Chamfer envelope outside supported domain.')
            tool=doc.addObject('Part::Loft',name+'C05Loft');tool.Sections=pp;tool.Solid=True;tool.MaxDegree=8;doc.recompute();healthy(tool);shaft=cut(name+'ContinuousEdgeChamfer',shaft,tool);log(name+' continuous C edge complete')
        for name,z,sg in [('CamLeftEndC',cam0,1),('CamRightEndC',cam1,-1),('LeftShaftEndC',0,1)]:
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
        for name,obj in [('CamShaft',shaft),('RollerPlate',plate),('Roller',roller)]:
            healthy(obj);obj.Shape.exportStep(str(out/'STEP'/(name+'.step')))
        world=[]
        for o in links:
            sh=o.LinkedObject.Shape.copy();sh.Placement=o.LinkPlacement.multiply(sh.Placement);world.append(sh)
        assemblyShape=Part.makeCompound(world);assemblyShape.exportStep(str(out/'STEP/Assembly.step'))
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
        doc.saveAs(str(out/'NativeGeometry.FCStd'))
        log('Building native TechDraw pages')
        from drawings import build_pages
        pages,dimensions=build_pages(doc,c,shaft,plate,roller,links,out)
        doc.recompute();fc=out/(c['project']+'.FCStd');doc.saveAs(str(fc))
        from dxf_finish import export_page
        for p in pages:export_page(p,out/'DXF'/(p.Name+'.dxf'),c['project'])
        # Reopen serialized native document, verify object graph and actual STEP files.
        part_names=[shaft.Name,plate.Name,roller.Name]
        A.closeDocument(doc.Name);doc=A.openDocument(str(fc));doc.recompute()
        checks['reopen_native_solids']=[len(doc.getObject(name).Shape.Solids) for name in part_names]
        checks['drawing_pages']=len(pages);checks['native_dimensions']=len(dimensions)
        checks['step_reopen']=[]
        for p in (out/'STEP').glob('*.step'):
            sh=Part.Shape();sh.read(str(p));valid=sh.isValid();expected=c['roller_count']+2 if p.stem=='Assembly' else 1
            checks['step_reopen'].append({'file':p.name,'valid':valid,'solids':len(sh.Solids)})
            if not valid or len(sh.Solids)!=expected:raise RuntimeError('STEP verification failed: '+p.name)
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

