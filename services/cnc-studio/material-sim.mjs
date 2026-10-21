// Bounded sampled swept-tool removal for top-accessible, three-axis stock.
// Heightfield representation approximates material removal; no closed-cavity or physical verification.

const density={al6061:2.70,s45c:7.85,sus304:7.93}; // g/cm^3; nominal reference values
const valid=(v,name,lo,hi)=>{
 if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)throw Error(`${name} 必須介於 ${lo} 與 ${hi}`);
 return v;
};

export function simulateStock(moves,catalog,config,notify=()=>{}){
 if(!Array.isArray(moves)||moves.length<1||moves.length>80000)throw Error('模擬刀路數量需為 1–80,000 段');
 const sx=valid(config.x,'素材 X',1,800),sy=valid(config.y,'素材 Y',1,800),sz=valid(config.z,'素材 Z',.5,400);
 const top=valid(config.top_z,'素材頂面 G54 Z',-500,500),bottom=top-sz;
 const resolution=valid(config.resolution_mm,'模擬網格精度',.35,5);
 const material=config.material;
 if(!(material in density)||!catalog.materials.some(m=>m.id===material))throw Error('未知的素材材料');
 const nx=Math.max(1,Math.ceil(sx/Math.max(resolution,sx/180)));
 const ny=Math.max(1,Math.ceil(sy/Math.max(resolution,sy/180)));
 if(nx*ny>35000)throw Error('網格過大，請調高網格間距');
 const dx=sx/nx,dy=sy/ny,pitch=Math.min(dx,dy);
 const tools=new Map(catalog.tools.map(t=>[t.id,t]));
 const rapid=valid(config.rapid_mm_min||12000,'快移速度',100,60000);
 let totalSeconds=0,plannedSamples=0;
 const times=[];
 for(const m of moves){
  const tool=tools.get(m.tool);
  if(!tool||!['endmill','ballmill','drill'].includes(tool.kind))throw Error(`刀具 ${m.tool} 不可用於模擬`);
  if(!['G0','G1'].includes(m.mode)||!m.a?.length||!m.b?.length)throw Error('僅支援 G0/G1 三軸直線刀路');
  for(const v of [...m.a,...m.b])valid(v,'刀具座標',-10000,10000);
  const length=Math.hypot(...m.a.map((v,i)=>m.b[i]-v));
  const speed=m.mode==='G0'?rapid:valid(m.feed,'切削進給',.01,60000);
  const duration=60*length/speed;
  totalSeconds+=duration;times.push(duration);
  if(m.mode==='G1')plannedSamples+=Math.max(1,Math.ceil(length/(pitch*.68)));
 }
 if(plannedSamples>650000)throw Error('刀路樣本數超過 650,000，請調大網格精度或縮短 G-code');
 const grid=new Float32Array(nx*ny).fill(top);
 let removed=0,touched=0,elapsed=0,rapidRisks=0,beyondBottom=0,rapidSamples=0;
 const frames=[{progress:0,removed_mm3:0,heights:grid.slice()}];
 let nextFrame=1;
 const steps=60;
 const record=()=>{
  frames.push({progress:nextFrame/steps,removed_mm3:Math.max(0,removed),heights:grid.slice()});nextFrame++;
 };
 const toolSweep=(x,y,z,tool,remove)=>{
  const radius=tool.diameter/2;
  if(x+radius<=0||x-radius>=sx||y+radius<=0||y-radius>=sy)return false;
  if(z>top+radius+1)return false;
  const ix0=Math.max(0,Math.ceil((x-radius)/dx-.5));
  const ix1=Math.min(nx-1,Math.floor((x+radius)/dx-.5));
  const iy0=Math.max(0,Math.ceil((y-radius)/dy-.5));
  const iy1=Math.min(ny-1,Math.floor((y+radius)/dy-.5));
  for(let j=iy0;j<=iy1;j++)for(let i=ix0;i<=ix1;i++){
   const rx=(i+.5)*dx-x,ry=(j+.5)*dy-y,d2=rx*rx+ry*ry;
   if(d2>radius*radius)continue;
   let tip=z;
   if(tool.kind==='ballmill')tip+=radius-Math.sqrt(Math.max(0,radius*radius-d2));
   else if(tool.kind==='drill')tip+=Math.sqrt(d2)/Math.tan(59*Math.PI/180);
   const next=Math.max(bottom,tip),index=j*nx+i;
   if(next<grid[index]-1e-5){
    if(!remove)return true;
    const last=grid[index];grid[index]=next;
    removed+=(last-grid[index])*dx*dy;
    touched++;
   }
  }
  return false;
 };
 // Stock volume is approximated at cell centers; record uniformly in simulated elapsed time.
 for(let moveIndex=0;moveIndex<moves.length;moveIndex++){
  const m=moves[moveIndex],tool=tools.get(m.tool),duration=times[moveIndex];
  const length=Math.hypot(...m.a.map((v,i)=>m.b[i]-v));
  if(m.mode==='G0'){
   // Clip to the stock's cutter-expanded bounding volume before sampling; a long
   // approach from outside the blank must not skip a narrow contact interval.
   const r=tool.diameter/2,lo=[-r,-r,bottom-r-1],hi=[sx+r,sy+r,top+r+1];
   let t0=0,t1=1;
   for(let axis=0;axis<3;axis++){
    const delta=m.b[axis]-m.a[axis];
    if(Math.abs(delta)<1e-12){if(m.a[axis]<lo[axis]||m.a[axis]>hi[axis])t1=-1;continue;}
    const a=(lo[axis]-m.a[axis])/delta,b=(hi[axis]-m.a[axis])/delta;
    t0=Math.max(t0,Math.min(a,b));t1=Math.min(t1,Math.max(a,b));
   }
   if(t1>=t0){
    const span=length*(t1-t0),needed=Math.max(1,Math.ceil(span/(pitch*.45)));
    // Any unexamined part of a potentially intersecting rapid is conservatively risky.
    const count=Math.min(needed,4000);
    rapidSamples+=count+1;
    if(rapidSamples>400000)throw Error('G00 快移接觸檢查超過 400,000 個樣本，請分段縮短刀路');
    let contact=needed>count;
    for(let i=0;i<=count;i++){
     const t=t0+(t1-t0)*i/count,p=m.a.map((v,k)=>v+(m.b[k]-v)*t);
     if(toolSweep(...p,tool,false)){contact=true;break;}
    }
    if(contact)rapidRisks++;
   }
   elapsed+=duration;
   while(nextFrame<=steps&&elapsed/Math.max(totalSeconds,1e-9)>=nextFrame/steps)record();
   continue;
  }
  if(Math.min(m.a[2],m.b[2])<bottom-.05)beyondBottom++;
  const n=Math.max(1,Math.ceil(length/(pitch*.68)));
  for(let i=1;i<=n;i++){
   const t=i/n;
   toolSweep(...m.a.map((v,k)=>v+(m.b[k]-v)*t),tool,true);
   const moment=elapsed+duration*t;
   while(nextFrame<=steps&&moment/Math.max(totalSeconds,1e-9)>=nextFrame/steps)record();
  }
  elapsed+=duration;
  if(moveIndex%500===0)notify(`模擬除料：${Math.round(100*(moveIndex+1)/moves.length)}%`);
 }
 while(nextFrame<=steps)record();
 const sourceVolume=sx*sy*sz,removedVolume=Math.min(sourceVolume,Math.max(0,removed));
 const warnings=[];
 if(rapidRisks)warnings.push(`${rapidRisks} 段 G00 快移可能進入素材包絡；視為碰撞風險，快移不執行除料。`);
 if(beyondBottom)warnings.push(`${beyondBottom} 段 G01 深於素材底面，未檢查底座／虎鉗／治具碰撞。`);
 warnings.push('除料採固定 Z 刀軸與 XY 高度網格近似，不能表現倒扣、側孔或封閉內腔；未計算刀柄、切削力、刀具變形、真實機台干涉。');
 const removedPct=100*removedVolume/sourceVolume;
 return {version:1,x:sx,y:sy,z:sz,top_z:top,bottom_z:bottom,nx,ny,dx,dy,material,resolution_mm:Math.max(dx,dy),
  frames,removed_mm3:removedVolume,remaining_mm3:sourceVolume-removedVolume,remaining_pct:100-removedPct,
  removed_mass_g:removedVolume/1000*density[material],minutes:totalSeconds/60,affected_cells:touched,
  rapid_risk_segments:rapidRisks,bottom_risk_segments:beyondBottom,warnings,
  scope:'sampled top-surface heightfield 3-axis G01 sweep; visualization only'};
}
