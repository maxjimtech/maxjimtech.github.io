"""Linked TechDraw views, sections, dimensions and editable DXF export."""
import FreeCAD as A, Part, math, pathlib

def build_pages(doc,c,cam,plate,roller,links,out):
    pages=[];ledger=[]
    def page(name,title):
        from reference_frame import write_svg
        template=pathlib.Path(out)/(name+'_Frame.svg');write_svg(template,c['project'],name)
        p=doc.addObject('TechDraw::DrawPage',name);p.ProjectionType='Third angle';t=doc.addObject('TechDraw::DrawSVGTemplate',name+'Template');t.Template=str(template);p.Template=t
        pages.append(p);return p
    def view(p,name,source,direction,x,y,scale=1,xdir=None):
        print('TechDraw view '+name,flush=True)
        v=doc.addObject('TechDraw::DrawViewPart',name);v.CoarseView=name.startswith('Assembly') or name in ['CamSide','CamIso'];v.Source=source;v.Direction=A.Vector(*direction);v.ScaleType='Custom';v.Scale=scale;v.X=x;v.Y=y
        if xdir:v.XDirection=A.Vector(*xdir)
        v.HardHidden=False;v.SmoothVisible=False;v.SeamVisible=False;p.addView(v);v.X=x;v.Y=y;v.LockPosition=True;doc.recompute();return v
    def note(p,name,text,x,y):
        rows=[]
        for i,line in enumerate(text):
            n=doc.addObject('TechDraw::DrawViewAnnotation',name+'_%02d'%i);n.Text=[line];n.TextSize=2.5;n.Font='Arial';p.addView(n);n.X=x;n.Y=y-5*i;n.LockPosition=True;rows.append(n)
        return rows
    def dim(p,v,name,kind,refs,x,y,expected=None):
        d=doc.addObject('TechDraw::DrawViewDimension',name);d.Type=kind;d.References2D=[(v,tuple(refs))];d.X=x;d.Y=y;d.FormatSpec='%value';d.ShowUnits=False;p.addView(d);d.X=x-float(v.X);d.Y=y-float(v.Y);d.LockPosition=True;doc.recompute();value=d.getRawValue()
        if value<=0 or 'Invalid' in d.State:raise RuntimeError('Native dimension failed: '+name)
        ledger.append({'dimension':name,'page':p.Name,'view':v.Name,'type':kind,'references':refs,'measured_mm':value,'nominal_mm':expected,'arbitrary':False});return d
    def circle_dim(p,v,name,r,x,y):
        found=None
        # FreeCAD projected edges use zero-based Edge identifiers.
        for i in range(len(v.getVisibleEdges())+len(v.getHiddenEdges())):
            try:e=v.getEdgeByIndex(i)
            except Exception:continue
            if isinstance(e.Curve,Part.Circle) and abs(e.Curve.Radius-r)<1e-5 and e.Curve.Center.Length<1e-5:found='Edge'+str(i);break
        if found is None:raise RuntimeError('No projected centre circle for dimension '+name)
        return dim(p,v,name,'Diameter',[found],x,y,2*r)
    def extent(p,v,name,axis,x,y,expected):
        pts=v.getVisibleVertexes()
        if len(pts)<2:raise RuntimeError('No projected vertices: '+name)
        low=min(range(len(pts)),key=lambda i:getattr(pts[i],axis));high=max(range(len(pts)),key=lambda i:getattr(pts[i],axis))
        return dim(p,v,name,'DistanceX' if axis=='x' else 'DistanceY',['Vertex'+str(low),'Vertex'+str(high)],x,y,expected)
    p=page('AssemblyDrawing','RD065 assembly / review')
    from native_features import AssemblyShape
    projected=doc.addObject('Part::FeaturePython','AssemblyDrawingSource');AssemblyShape(projected,links);doc.recompute();projected.Visibility=False
    av=view(p,'AssemblyFront',[projected],(0,0,1),130,155,.8,(1,0,0))
    view(p,'AssemblySide',[projected],(1,0,0),315,155,.8,(0,1,0))
    view(p,'AssemblyIso',[projected],(1,-1,1),105,60,.5)
    note(p,'AssemblyBOM',['1  Cam shaft      x1','2  Roller plate   x1','3  Roller OD envelope  x'+str(c['roller_count']),'Ratio '+str(c['ratio'])+':1 / constant velocity','Axis spacing '+str(c['axis_distance_mm'])+' mm','Static placement; no kinematic solver joints'],275,84)
    p=page('CamDrawing','1A Cam shaft / review')
    front=view(p,'CamSide',[cam],(0,-1,0),190,180,1,(0,0,1));view(p,'CamIso',[cam],(1,-1,1),105,70,.65)
    stock=doc.getObject('CamStock')
    if stock is None:
        stock=doc.addObject('Part::Cylinder','CamStock');stock.Radius=c['cam_od_mm']/2;stock.Height=c['cam_width_mm'];stock.Placement.Base.z=71;doc.recompute();stock.Visibility=False
    end=view(p,'CamStockEndReference',[stock],(0,0,1),355,180,1,(1,0,0))
    extent(p,front,'CamOverallLength','x',190,220,c['shaft_length_mm']);circle_dim(p,end,'CamNominalOD',c['cam_od_mm']/2,355,225)
    note(p,'CamNotes',['CNC 4-axis continuous cutter groove','Nominal root DIA '+str(c['cam_root_mm'])+'; working width '+str(c['cam_width_mm']),'Cam outer-edge chamfers omitted (sample)','M20x1.5: nominal 15 mm thread blank','M6x1: nominal 12 mm incl. 5 mm counterbore','Conventional thread representation; teeth not modeled','Cam curve views: fast polygonal projection','OD dimension linked to native stock reference','REVIEW: tolerances / finish / fits not specified'],275,89)
    p=page('PlateDrawing','2A Roller plate / review')
    pv=view(p,'PlateFront',[plate],(0,0,1),120,168,1,(1,0,0));side=view(p,'PlateSide',[plate],(1,0,0),315,175,1,(0,0,1))
    circle_dim(p,pv,'PlateOutsideDiameter',c['plate_od_mm']/2,110,262);circle_dim(p,pv,'PlateBoreDiameter',c['plate_bore_mm']/2,122,170)
    extent(p,side,'PlateThickness','x',315,270,c['plate_thickness_mm'])
    sec=doc.addObject('TechDraw::DrawViewSection','PlateSectionAA');sec.BaseView=pv;sec.Source=[plate];sec.SectionOrigin=A.Vector(0,0,c['plate_thickness_mm']/2);sec.SectionNormal=A.Vector(1,0,0);sec.Direction=A.Vector(1,0,0);sec.XDirection=A.Vector(0,0,1);sec.ScaleType='Custom';sec.Scale=.6;p.addView(sec);sec.X=205;sec.Y=64;sec.LockPosition=True
    note(p,'PlateHoleNotes',[str(c['roller_count'])+' x DIA '+str(c['roller_bore_mm'])+' THRU / PCD '+str(c['roller_pcd_mm'])+' / phase 0 deg','Follower back countersinks DIA11 / 90deg assumed','10 x DIA 6.5 THRU / PCD85 / phase90 deg','10 x M5x0.8 / DIA4.2 drill / PCD95 / DIA6 end relief','5 x DIA6 THRU / PCD136 / phase9 deg','2 x DIA6 THRU / PCD110 / phase-9 deg','Outer edge C1.5 back / C1.2 front','Thread teeth / fit classes not modeled'],300,84)
    p=page('RollerDrawing','Roller OD envelope / review')
    rv=view(p,'RollerSide',[roller],(0,-1,0),115,172,3,(0,0,1));end=view(p,'RollerEnd',[roller],(0,0,1),290,175,3,(1,0,0));view(p,'RollerIso',[roller],(1,-1,1),100,70,2)
    extent(p,rv,'RollerOverallLength','x',115,235,c['roller_total_length_mm']);circle_dim(p,end,'RollerOutsideDiameter',c['roller_od_mm']/2,295,225)
    note(p,'RollerNotes',['Confirmed roller OD '+str(c['roller_od_mm'])+' mm','Working band '+str(c['roller_working_width_mm'])+' mm (inferred)','Stud DIA8; shoulder DIA10 x1.65; tip DIA8 x1','Bearing internal geometry / rating not specified','Do not use as bearing fabrication detail'],280,80)
    doc.recompute();return pages,ledger

