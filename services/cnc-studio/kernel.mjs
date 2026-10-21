// Exact 2.5D BREP support gate; separate constrained mesh heightfield screening for surface drafts.
import {inspectSurface} from './surface.mjs';
export function analyzeSTEP(oc,bytes,name='part.step'){
 const owned=[]; const own=o=>(owned.push(o),o); const E=oc.TopAbs_ShapeEnum;
 const xyz=p=>[p.X(),p.Y(),p.Z()];
 const enumerate=(s,type,fn)=>{const ex=own(new oc.TopExp_Explorer_2(s,type,E.TopAbs_SHAPE));let n=0;for(;ex.More();ex.Next())fn(own(ex.Current()),n++);return n;};
 const bounds=s=>{const b=own(new oc.Bnd_Box_1());oc.BRepBndLib.AddOptimal(s,b,false,false);return [b.GetXmin(),b.GetYmin(),b.GetZmin(),b.GetXmax(),b.GetYmax(),b.GetZmax()];};
 const measure=(s,area=false)=>{const g=own(new oc.GProp_GProps_1());if(area)oc.BRepGProp.SurfaceProperties_1(s,g,false,false);else oc.BRepGProp.VolumeProperties_1(s,g,true,false,false);return g.Mass();};
 const cut=(a,b)=>{const op=own(new oc.BRepAlgoAPI_Cut_3(a,b));if(!op.IsDone())throw Error('布林差集失敗，不能判定支援');return own(op.Shape());};
 const commonVolume=(a,b)=>{const op=own(new oc.BRepAlgoAPI_Common_3(a,b));if(!op.IsDone())throw Error('布林交集失敗');return Math.abs(measure(own(op.Shape())));};
 const point=(x,y,z)=>own(new oc.gp_Pnt_3(x,y,z));
 const box=(x,y,z,w,h,d)=>own(own(new oc.BRepPrimAPI_MakeBox_2(point(x,y,z),w,h,d)).Shape());
 const cylinder=(x,y,z,r,h)=>{const axis=own(new oc.gp_Ax2_3(point(x,y,z),own(new oc.gp_Dir_4(0,0,1))));return own(own(new oc.BRepPrimAPI_MakeCylinder_3(axis,r,h)).Shape());};
 let file='/x.step';
 try{
  oc.FS.writeFile(file,bytes);const reader=own(new oc.STEPControl_Reader_1());
  if(reader.ReadFile(file).value!==oc.IFSelect_ReturnStatus.IFSelect_RetDone.value)throw Error('STEP 格式讀取失敗');
  if(reader.TransferRoots()<1)throw Error('STEP 沒有可轉移的根形狀');
  const shape=own(reader.OneShape());if(shape.IsNull())throw Error('STEP 為空形狀');
  const solidCount=enumerate(shape,E.TopAbs_SOLID,()=>{}),checker=own(new oc.BRepCheck_Analyzer(shape,true));
  const valid=checker.IsValid_2();const b=bounds(shape),size=b.slice(3).map((v,i)=>v-b[i]);
  if(size.some(v=>!Number.isFinite(v)||v<=0||v>2000))throw Error('尺寸超過本版 0–2000 mm 範圍或無效');
  const features=[],cavities=[],V=measure(shape);let faceCount=0,solidFaces=0;
  enumerate(shape,E.TopAbs_SOLID,s=>{solidFaces+=enumerate(s,E.TopAbs_FACE,()=>{});});
  enumerate(shape,E.TopAbs_FACE,(s,i)=>{
   faceCount++;const face=own(oc.TopoDS.Face_1(s)),surface=own(new oc.BRepAdaptor_Surface_2(face,true));
   const bb=bounds(face),[xmin,ymin,zmin,xmax,ymax,zmax]=bb,w=xmax-xmin,h=ymax-ymin;
   const type=surface.GetType();
   if(type.value===oc.GeomAbs_SurfaceType.GeomAbs_Plane.value&&zmax-zmin<1e-5&&zmin>b[2]+1e-5&&zmin<b[5]-1e-5){
    let lines=true;const edges=enumerate(face,E.TopAbs_EDGE,e=>{const edge=own(oc.TopoDS.Edge_1(e));const curve=own(new oc.BRepAdaptor_Curve_2(edge));if(curve.GetType().value!==oc.GeomAbs_CurveType.GeomAbs_Line.value)lines=false;});
    if(lines&&edges===4&&Math.abs(measure(face,true)-w*h)<1e-4){
     const cavity=box(xmin,ymin,zmin,w,h,b[5]-zmin);
     if(commonVolume(shape,cavity)<1e-5){features.push({kind:'pocket',id:'F'+(i+1),x:xmin-b[0],y:ymin-b[1],w,h,depth:b[5]-zmin});cavities.push(cavity);}
    }
   }
   if(type.value===oc.GeomAbs_SurfaceType.GeomAbs_Cylinder.value&&Math.abs(zmax-b[5])<1e-5&&Math.abs(zmin-b[2])<1e-5){
    const cyl=own(surface.Cylinder()),axis=own(cyl.Axis()),dir=own(axis.Direction()),center=own(cyl.Location()),r=cyl.Radius();
    if(Math.abs(Math.abs(dir.Z())-1)<1e-6&&Math.abs(measure(face,true)-2*Math.PI*r*size[2])<1e-3&&center.X()-r>b[0]&&center.Y()-r>b[1]&&center.X()+r<b[3]&&center.Y()+r<b[4]){
     const cavity=cylinder(center.X(),center.Y(),b[2],r,size[2]);if(commonVolume(shape,cavity)<1e-5){features.push({kind:'drill',id:'F'+(i+1),x:center.X()-b[0],y:center.Y()-b[1],diameter:2*r,depth:size[2]});cavities.push(cavity);}
    }
   }
  });
  features.sort((a,b)=>(a.kind==='pocket'?0:1)-(b.kind==='pocket'?0:1));
  let difference=null,supported=false;
  if(valid&&solidCount===1&&faceCount===solidFaces&&features.length<=60&&V>0){
   let expected=box(b[0],b[1],b[2],...size);for(const c of cavities)expected=cut(expected,c);
   difference=Math.abs(measure(cut(expected,shape)))+Math.abs(measure(cut(shape,expected)));
   supported=difference<Math.max(1e-4,V*1e-7);
  }
  own(new oc.BRepMesh_IncrementalMesh_2(shape,Math.max(.12,Math.max(...size)/400),false,.5,false));
  const vertices=[],triangles=[];
  enumerate(shape,E.TopAbs_FACE,s=>{
   const face=own(oc.TopoDS.Face_1(s)),location=own(new oc.TopLoc_Location_1()),handle=own(oc.BRep_Tool.Triangulation(face,location));
   if(handle.IsNull())return;const triangulation=handle.get(),offset=vertices.length,trsf=own(location.Transformation());
   for(let i=1;i<=triangulation.NbNodes();i++){const p=own(triangulation.Node(i)),v=own(p.Transformed(trsf));vertices.push([v.X()-b[0],v.Y()-b[1],v.Z()-b[5]]);}
   for(let i=1;i<=triangulation.NbTriangles();i++){const t=own(triangulation.Triangle(i)),indices=[t.Value(1)-1+offset,t.Value(2)-1+offset,t.Value(3)-1+offset];if(face.Orientation_1().value===oc.TopAbs_Orientation.TopAbs_REVERSED.value)indices.reverse();triangles.push(indices);}
   if(triangles.length>100000)throw Error('網格超過 100,000 三角形，請先簡化模型');
  });
  const model={name,size,vertices,triangles,features,supported,difference_mm3:difference,
   frame:'G54 X/Y finished bbox minimum; finished top Z0; +Z tool axis',
   audit:{valid,solid_count:solidCount,face_count:faceCount,volume_mm3:V,bounds_mm:b,size_mm:size,engine:'OpenCascade.js 1.1.1 / OCCT 7.4 WASM'},
   limitations:supported?[]:['不符合本版單一實體、矩形塊＋頂開矩形口袋＋垂直通孔的精確重建條件。可預覽，禁止 NC。']};
  model.surface=inspectSurface(model);
  return model;
 }finally{
  try{oc.FS.unlink(file);}catch{}
  for(let i=owned.length-1;i>=0;i--){try{owned[i].delete();}catch{}}
 }
}
