// Canvas stock-removal rendering, independent of STEP geometry and CNC postprocessing.
const metals={al6061:[72,156,151],s45c:[123,143,153],sus304:[160,180,190]};
const tone=(base,shade)=>`rgb(${base.map(x=>Math.max(0,Math.min(255,Math.round(x*shade)))).join(',')})`;

export function simulationFrame(sim,progress){
 const normalized=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0));
 return sim.frames[Math.min(sim.frames.length-1,Math.round(normalized*(sim.frames.length-1)))];
}

export function renderStock(ctx,sim,progress,view,project){
 if(!sim?.frames?.length)return;
 const frame=simulationFrame(sim,progress),heights=frame.heights;
 const {nx,ny,dx,dy,top_z:top,bottom_z:bottom,x:sx,y:sy}=sim;
 const base=metals[sim.material]||metals.al6061;
 const height=(ix,iy)=>heights[Math.min(ny-1,Math.max(0,iy))*nx+Math.min(nx-1,Math.max(0,ix))];
 const polygon=(points,fill,outline=false)=>{
  if(points.length<3)return;
  ctx.beginPath();points.map(project).forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
  ctx.closePath();ctx.fillStyle=fill;ctx.fill();
  if(outline){ctx.strokeStyle='rgba(34,72,76,.10)';ctx.lineWidth=.35;ctx.stroke();}
 };
 if(view==='xy'){
  // Top view: darker cells show removed depth; entirely removed cells show background.
  const p0=project([0,0,top]),p1=project([dx,dy,top]);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
   const h=height(x,y);if(h<=bottom+1e-6)continue;
   const q=project([x*dx,y*dy,top]);
   const shade=.97-.5*(top-h)/Math.max(.1,top-bottom);
   ctx.fillStyle=tone(base,shade);
   ctx.fillRect(Math.min(q[0],q[0]+p1[0]-p0[0]),Math.min(q[1],q[1]+p1[1]-p0[1]),Math.abs(p1[0]-p0[0])+1,Math.abs(p1[1]-p0[1])+1);
  }
  polygon([[0,0,top],[sx,0,top],[sx,sy,top],[0,sy,top]],'rgba(255,255,255,0)',true);
  return;
 }
 if(view==='xz'||view==='yz'){
  const isX=view==='xz',cells=isX?nx:ny,fixed=isX?ny/2|0:nx/2|0;
  const maxWidth=isX?sx:sy,step=isX?dx:dy;
  // One middle section of the real heightfield; it is not a full volumetric section.
  for(let i=0;i<cells;i++){
   const h=isX?height(i,fixed):height(fixed,i);
   if(h<=bottom+1e-6)continue;
   const a=i*step,b=(i+1)*step;
   const plane=(t,z)=>isX?[t,sy/2,z]:[sx/2,t,z];
   polygon([plane(a,bottom),plane(b,bottom),plane(b,h),plane(a,h)],tone(base,.86-.22*(top-h)/(top-bottom)));
  }
  const plane=(t,z)=>isX?[t,sy/2,z]:[sx/2,t,z];
  polygon([plane(0,bottom),plane(maxWidth,bottom),plane(maxWidth,top),plane(0,top)],'rgba(255,255,255,0)',true);
  return;
 }
 const stride=Math.max(1,Math.ceil(Math.max(nx,ny)/85)),faces=[];
 // Render up to roughly 7,225 sampled cells to keep playback interactive.
 const sampled=[];
 for(let j=0;j<ny;j+=stride){
  const row=[];
  for(let i=0;i<nx;i+=stride){
   let sum=0,count=0;
   for(let yy=j;yy<Math.min(ny,j+stride);yy++)for(let xx=i;xx<Math.min(nx,i+stride);xx++){sum+=height(xx,yy);count++;}
   // Mean height avoids painting every tile at its single deepest sample.
   row.push(sum/count);
  }
  sampled.push(row);
 }
 const addFace=(pts,shade)=>{
  const projected=pts.map(project);faces.push({pts,shade,depth:projected.reduce((s,p)=>s+p[2],0)/pts.length});
 };
 for(let j=0;j<sampled.length;j++)for(let i=0;i<sampled[j].length;i++){
  const z=sampled[j][i],x0=i*stride*dx,x1=Math.min(sx,(i+1)*stride*dx);
  const y0=j*stride*dy,y1=Math.min(sy,(j+1)*stride*dy);
  if(z<=bottom+1e-5)continue;
  const shade=.97-.42*(top-z)/Math.max(.1,top-bottom);
  addFace([[x0,y0,z],[x1,y0,z],[x1,y1,z],[x0,y1,z]],shade);
  const zX=i+1<sampled[j].length?sampled[j][i+1]:bottom;
  const zY=j+1<sampled.length?sampled[j+1][i]:bottom;
  if(z>zX+1e-4)addFace([[x1,y0,zX],[x1,y1,zX],[x1,y1,z],[x1,y0,z]],shade*.70);
  if(z>zY+1e-4)addFace([[x0,y1,zY],[x1,y1,zY],[x1,y1,z],[x0,y1,z]],shade*.79);
  if(i===0)addFace([[x0,y0,bottom],[x0,y1,bottom],[x0,y1,z],[x0,y0,z]],shade*.70);
  if(j===0)addFace([[x0,y0,bottom],[x1,y0,bottom],[x1,y0,z],[x0,y0,z]],shade*.78);
 }
 faces.sort((a,b)=>a.depth-b.depth);
 for(const face of faces)polygon(face.pts,tone(base,face.shade),true);
}
