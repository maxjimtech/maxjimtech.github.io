// Approximate binary STL of the remaining top-accessible heightfield stock.
// Not a source STEP/BREP reconstruction, CAM qualification, or manufacturing model.
export function stockAsSTL(sim){
 if(!sim?.frames?.length)throw Error('必須先完成素材除料模擬');
 const heights=sim.frames.at(-1).heights;
 const {nx,ny,dx,dy,bottom_z:bottom}=sim;
 if(nx*ny!==heights.length||nx*ny>35000)throw Error('素材網格資料無效');
 // Quantize all neighboring cells to the same 0.0001 mm elevations. Tiny
 // Float32 differences must not produce cracks along what should be shared edges.
 const quantized=Float64Array.from(heights,h=>bottom+Math.max(0,Math.round((Math.max(bottom,h)-bottom)*1e4))/1e4);
 const height=(i,j)=>i<0||j<0||i>=nx||j>=ny?bottom:quantized[j*nx+i];
 const triangles=[];
 const quad=(a,b,c,d)=>{triangles.push(a,b,c,a,c,d);};
 // Vertices along a grid-line corner must be split at ALL four neighboring
 // elevations; otherwise a stepped heightfield STL has hanging T-junctions.
 const cornerLevels=(i,j,lower,upper)=>{
  const values=[lower,upper];
  for(let y=j-1;y<=j;y++)for(let x=i-1;x<=i;x++){
   const z=height(x,y);
   if(z>lower&&z<upper)values.push(z);
  }
  return [...new Set(values)].sort((a,b)=>a-b);
 };
 const side=(i0,j0,i1,j1,lower,upper,reverse)=>{
  const a=cornerLevels(i0,j0,lower,upper),b=cornerLevels(i1,j1,lower,upper);
  let ai=0,bi=0;
  const vertex=(i,j,z)=>[i*dx,j*dy,z];
  while(ai<a.length-1||bi<b.length-1){
   const p=vertex(i0,j0,a[ai]),q=vertex(i1,j1,b[bi]);
   let r;
   if(ai<a.length-1&&(bi===b.length-1||a[ai+1]<=b[bi+1]))r=vertex(i0,j0,a[++ai]);
   else r=vertex(i1,j1,b[++bi]);
   if(reverse)triangles.push(p,r,q);else triangles.push(p,q,r);
  }
 };
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  const top=height(i,j);
  if(top<=bottom)continue;
  const x0=i*dx,x1=(i+1)*dx,y0=j*dy,y1=(j+1)*dy;
  quad([x0,y0,top],[x1,y0,top],[x1,y1,top],[x0,y1,top]);
  quad([x0,y0,bottom],[x0,y1,bottom],[x1,y1,bottom],[x1,y0,bottom]);
  const loLeft=Math.max(bottom,height(i-1,j));
  const loRight=Math.max(bottom,height(i+1,j));
  const loDown=Math.max(bottom,height(i,j-1));
  const loUp=Math.max(bottom,height(i,j+1));
  if(top>loLeft)side(i,j,i,j+1,loLeft,top,true);
  if(top>loRight)side(i+1,j,i+1,j+1,loRight,top,false);
  if(top>loDown)side(i,j,i+1,j,loDown,top,false);
  if(top>loUp)side(i,j+1,i+1,j+1,loUp,top,true);
 }
 const count=triangles.length/3,buffer=new ArrayBuffer(84+count*50),view=new DataView(buffer);
 if(!count)throw Error('素材已全部移除，沒有可匯出的封閉剩餘實體');
 const header='CNC STUDIO APPROX REMOVAL STL - HEIGHTFIELD ONLY';
 for(let i=0;i<header.length;i++)view.setUint8(i,header.charCodeAt(i));
 view.setUint32(80,count,true);let offset=84;
 for(let i=0;i<triangles.length;i+=3){
  const [a,b,c]=triangles.slice(i,i+3),u=b.map((n,k)=>n-a[k]),v=c.map((n,k)=>n-a[k]);
  const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const mag=Math.hypot(...n)||1;
  for(let k=0;k<3;k++){view.setFloat32(offset,n[k]/mag,true);offset+=4;}
  for(const vertex of [a,b,c])for(const component of vertex){view.setFloat32(offset,component,true);offset+=4;}
  view.setUint16(offset,0,true);offset+=2;
 }
 return {buffer,triangles:count,approximate:true};
}
