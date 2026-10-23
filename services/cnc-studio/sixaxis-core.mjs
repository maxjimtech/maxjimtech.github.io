import {parseGcode} from './gcode-import.mjs';

export const VERSION='0.7.0';
export const DEFAULT_MACHINE={id:'xyzabc',name:'XYZ + ABC 通用刀頭',order:'ZYX',coordinates:'tcp',limits:[[-400,400],[-300,300],[-200,500],[-180,180],[-180,180],[-720,720]],rapid:[12000,12000,10000,3600,3600,3600],max_rpm:24000};
export const MATERIALS={al6061:{name:'鋁合金 6061',density:2.70,color:[.43,.67,.77]},s45c:{name:'S45C 鋼',density:7.85,color:[.55,.60,.67]},sus304:{name:'SUS304',density:7.93,color:[.65,.68,.72]},wax:{name:'加工蠟',density:.90,color:[.45,.72,.53]}};
const d2r=Math.PI/180;
export const lerp=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
export const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const norm=v=>Math.hypot(...v);
const valid=(n,lo,hi,name)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<lo||n>hi)throw Error(`${name} 必須介於 ${lo} 與 ${hi}`);return n;};
const vec=(v,n,name,lo=-10000,hi=10000)=>{if(!Array.isArray(v)||v.length!==n)throw Error(`${name} 需有 ${n} 個數值`);return v.map(x=>valid(x,lo,hi,name));};

// Active fixed-axis rotations, column vectors. ZYX means Rz(C) Ry(B) Rx(A).
export function rotate(v,abc,order='ZYX'){
 let p=[...v];
 for(const axis of [...order].reverse()){
  const i='XYZ'.indexOf(axis),c=Math.cos(abc[i]*d2r),s=Math.sin(abc[i]*d2r),[x,y,z]=p;
  p=i===0?[x,c*y-s*z,s*y+c*z]:i===1?[c*x+s*z,y,-s*x+c*z]:[c*x-s*y,s*x+c*y,z];
 }
 return p;
}
export function pose(xyz,abc,tool,machine){
 const axis=rotate([0,0,1],abc,machine.order);
 const tip=machine.coordinates==='pivot'?xyz.map((v,i)=>v-axis[i]*tool.length):[...xyz];
 return {tip,axis,abc:[...abc],xyz:[...xyz]};
}
export function validateSetup(input){
 const s=structuredClone(input),m=s.machine;
 if(!m||!['ZYX','XYZ'].includes(m.order)||!['tcp','pivot'].includes(m.coordinates))throw Error('請選擇有效的旋轉順序與刀尖／樞軸座標');
 if(!Array.isArray(m.limits)||m.limits.length!==6)throw Error('母機需要六組行程界限');
 m.limits.forEach((v,i)=>{vec(v,2,'行程');if(v[0]>=v[1])throw Error('行程下限必須小於上限');});
 vec(m.rapid,6,'軸最高速度',1,60000);valid(m.max_rpm,1,100000,'最高轉速');
 vec(s.initial,6,'初始 XYZABC');
 const stock=s.stock;if(!stock)throw Error('缺少素材');vec(stock.min,3,'素材原點');vec(stock.size,3,'素材尺寸').forEach(v=>valid(v,.1,2000,'素材尺寸'));
 valid(stock.resolution,.2,10,'體素間距');if(!MATERIALS[stock.material])throw Error('未知材料');
 const dims=stock.size.map(v=>Math.ceil(v/stock.resolution));if(dims.reduce((a,b)=>a*b,1)>700000)throw Error('素材超過 700,000 體素，請增大體素間距或縮小素材');
 if(!Array.isArray(s.tools)||!s.tools.length||s.tools.length>64)throw Error('刀具數量需為 1–64');
 const ids=new Set(),nums=new Set();
 s.tools.forEach(t=>{if(typeof t.id!=='string'||!t.id||ids.has(t.id)||nums.has(t.number))throw Error('刀具 ID／T 編號不可重複');ids.add(t.id);nums.add(t.number);
  valid(t.number,1,9999,'T 編號');if(!Number.isInteger(t.number))throw Error('T 編號需為整數');
  if(!['endmill','ballmill','drill'].includes(t.kind))throw Error('刀型需為 endmill、ballmill 或 drill');
  ['diameter','flute_length','length','holder_diameter','holder_length'].forEach(k=>valid(t[k],.1,500,k));
  if(t.flute_length>t.length)throw Error('刃長不可超過刀具伸出長度');
  if(t.kind==='ballmill'&&t.flute_length<t.diameter/2)throw Error('球刀刃長不可小於半徑');
  if(t.kind==='drill'&&t.flute_length<t.diameter/2/Math.tan(59*d2r))throw Error('鑽頭刃長不足以容納 118° 鑽尖');
 });
 if(!ids.has(s.default_tool))throw Error('預設刀具不存在');
 if(!Array.isArray(s.fixtures)||s.fixtures.length>24)throw Error('夾具需為最多 24 個包絡盒');
 s.fixtures.forEach(f=>{vec(f.min,3,'夾具下限');vec(f.max,3,'夾具上限');if(f.min.some((v,i)=>v>=f.max[i]))throw Error('夾具下限必須小於上限');});
 return s;
}
export function compileProgram(source,input){
 const setup=validateSetup(input),m=setup.machine;
 const catalog={tools:setup.tools,machines:[{...m,travel:m.limits.slice(0,3).map(v=>v[1]-v[0])}]};
 const plan=parseGcode(source,catalog,{six_axis:true,machine:m.id,default_tool:setup.default_tool,initial_x:setup.initial[0],initial_y:setup.initial[1],initial_z:setup.initial[2],initial_abc:setup.initial.slice(3),arc_tolerance_mm:Math.min(.05,setup.stock.resolution/10)});
 const alerts=[],seen=new Set();let time=0;
 const add=(kind,line,t,detail)=>{const key=`${kind}:${line}:${detail}`;if(!seen.has(key)){seen.add(key);alerts.push({kind,line,time:t,detail});}};
 for(const move of plan.moves){
  const a=[...move.a,...move.abc_a],b=[...move.b,...move.abc_b],delta=b.map((v,i)=>Math.abs(v-a[i]));
  const linear=norm(sub(move.b,move.a)),rotary=Math.max(...delta.slice(3));
  const duration=move.mode==='G0'?Math.max(...delta.map((v,i)=>v/m.rapid[i]))*60:move.duration_s??(linear>1e-9?linear:rotary)/move.feed*60;
  if(!Number.isFinite(duration)||duration<=0)throw Error(`第 ${move.line} 行的運動時間無效`);
  move.t0=time;move.t1=time+duration;move.duration_s=duration;time=move.t1;
  for(let i=0;i<6;i++){
   const [lo,hi]=m.limits[i];if(a[i]<lo||a[i]>hi||b[i]<lo||b[i]>hi)add('overtravel',move.line,move.t0,`${'XYZABC'[i]} 軸超出 ${lo}…${hi}`);
   if(delta[i]/duration*60>m.rapid[i]+.01)add('overspeed',move.line,move.t0,`${'XYZABC'[i]} 軸需求 ${(delta[i]/duration*60).toFixed(1)} > 上限 ${m.rapid[i]}`);
  }
  if(move.rpm>m.max_rpm)add('rpm',move.line,move.t0,`主軸 ${move.rpm} rpm > ${m.max_rpm} rpm`);
 }
 return {setup,moves:plan.moves,alerts,duration:time,arc_summary:plan.arc_summary,source_lines:plan.source_lines,source,warnings:plan.warnings.filter(x=>!x.startsWith('支援三軸')&&!x.startsWith('初始刀尖'))};
}
export function moveAt(program,time){
 let lo=0,hi=program.moves.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(program.moves[mid].t1<time)lo=mid+1;else hi=mid;}
 const move=program.moves[lo],fraction=Math.max(0,Math.min(1,(time-move.t0)/move.duration_s));
 const tool=program.setup.tools.find(t=>t.id===move.tool);
 return {move,tool,fraction,...pose(lerp(move.a,move.b,fraction),lerp(move.abc_a,move.abc_b,fraction),tool,program.setup.machine)};
}
// Radius at axial position measured from the tool tip towards its holder.
export function cuttingRadius(tool,z){
 if(z<0||z>tool.flute_length)return -1;
 const r=tool.diameter/2;
 if(tool.kind==='ballmill'&&z<r)return Math.sqrt(Math.max(0,r*r-(z-r)**2));
 if(tool.kind==='drill')return Math.min(r,z*Math.tan(59*d2r));
 return r;
}
export function classifyPoint(point,p,tool){
 const d=sub(point,p.tip),z=dot(d,p.axis),r2=Math.max(0,dot(d,d)-z*z),r=cuttingRadius(tool,z);
 if(r>=0&&r2<=r*r+1e-9)return 'cutter';
 if(z>=tool.flute_length&&z<=tool.length&&r2<=(tool.diameter/2)**2)return 'shank';
 if(z>=tool.length&&z<=tool.length+tool.holder_length&&r2<=(tool.holder_diameter/2)**2)return 'holder';
 return null;
}
function envelope(p,t){
 const end=p.tip.map((v,i)=>v+p.axis[i]*(t.length+t.holder_length));
 const r=Math.max(t.diameter,t.holder_diameter)/2;
 return {min:p.tip.map((v,i)=>Math.min(v,end[i])-r*Math.sqrt(Math.max(0,1-p.axis[i]**2))),max:p.tip.map((v,i)=>Math.max(v,end[i])+r*Math.sqrt(Math.max(0,1-p.axis[i]**2)))};
}
// Conservative fixture test: sample tool axis + sphere radius; corner proximity may be a near-miss.
function fixtureContact(p,t,f,h){
 for(const [start,end,r,part] of [[0,t.flute_length,t.diameter/2,'刃部'],[t.flute_length,t.length,t.diameter/2,'刀桿'],[t.length,t.length+t.holder_length,t.holder_diameter/2,'刀把']]){
  const n=Math.max(1,Math.ceil((end-start)/Math.max(.1,Math.min(h,r))));
  for(let i=0;i<=n;i++){
   const z=start+(end-start)*i/n,c=p.tip.map((v,j)=>v+p.axis[j]*z);
   const distance=Math.hypot(...c.map((v,j)=>Math.max(f.min[j]-v,0,v-f.max[j])));
   if(distance<=r+((end-start)/n)/2)return part;
  }
 }
 return null;
}
export function simulate(program,onProgress=()=>{}){
 const {stock,tools,machine,fixtures}=program.setup,dims=stock.size.map(v=>Math.ceil(v/stock.resolution)),cell=stock.size.map((v,i)=>v/dims[i]);
 const count=dims.reduce((a,b)=>a*b,1),removedAt=new Float64Array(count);removedAt.fill(Infinity);
 const alerts=[...program.alerts],seen=new Set(alerts.map(a=>`${a.kind}:${a.line}`)),curve=[];
 let removed=0,visits=0,samples=0;
 const volume=cell.reduce((a,b)=>a*b,1),h=Math.min(...cell),maxVisits=180000000;
 const add=(kind,move,time,detail)=>{const key=`${kind}:${move.line}:${detail}`;if(!seen.has(key)){seen.add(key);alerts.push({kind,line:move.line,time,detail});}};
 for(let mi=0;mi<program.moves.length;mi++){
  const move=program.moves[mi],tool=tools.find(t=>t.id===move.tool);
  const travel=norm(sub(move.b,move.a)),angle=move.abc_b.reduce((s,v,i)=>s+Math.abs(v-move.abc_a[i])*d2r,0);
  const reach=tool.length+tool.holder_length+Math.max(tool.diameter,tool.holder_diameter)/2;
  const steps=Math.max(1,Math.ceil((travel+angle*reach)/(h*.45)));
  if(samples+steps+1>120000)throw Error('掃掠取樣超過 120,000 點；請縮短程式或增大體素間距');
  for(let k=0;k<=steps;k++){
   const u=k/steps,time=move.t0+u*move.duration_s,p=pose(lerp(move.a,move.b,u),lerp(move.abc_a,move.abc_b,u),tool,machine),box=envelope(p,tool);samples++;
   for(const f of fixtures){if(box.min.some((v,i)=>v>f.max[i]||box.max[i]<f.min[i]))continue;const part=fixtureContact(p,tool,f,h);if(part)add('fixture',move,time,`${f.name||'夾具'} 與${part}的保守包絡接近／相交`);}
   const lo=box.min.map((v,i)=>Math.max(0,Math.ceil((v-stock.min[i])/cell[i]-.5))),hi=box.max.map((v,i)=>Math.min(dims[i]-1,Math.floor((v-stock.min[i])/cell[i]-.5)));
   const blockCount=Math.max(0,hi[0]-lo[0]+1)*Math.max(0,hi[1]-lo[1]+1)*Math.max(0,hi[2]-lo[2]+1);visits+=blockCount;
   if(visits>maxVisits)throw Error('運算超過 1.8 億體素測試上限；請增大間距或拆分程式');
   for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
    const index=x+dims[0]*(y+dims[1]*z);if(removedAt[index]<=time)continue;
    const point=[x,y,z].map((v,i)=>stock.min[i]+(v+.5)*cell[i]),part=classifyPoint(point,p,tool);if(!part)continue;
    if(part!=='cutter'){add(part,move,time,`${part==='holder'?'刀把':'非切削刀桿'}與剩餘素材相交`);continue;}
    if(move.mode==='G0'){add('rapid',move,time,'快速移動穿入剩餘素材');continue;}
    if(!move.spindle){add('spindle',move,time,'主軸停止或 S0 時進給碰到素材');continue;}
    removedAt[index]=time;removed++;
   }
  }
  curve.push({time:move.t1,removed_mm3:removed*volume,line:move.line});
  if(mi%20===0)onProgress((mi+1)/program.moves.length);
 }
 alerts.sort((a,b)=>a.time-b.time);
 return {dims,cell,min:[...stock.min],size:[...stock.size],removedAt,alerts,curve,samples,visits,voxel_mm3:volume,removed_mm3:removed*volume,remaining_mm3:(count-removed)*volume,mass_g:(count-removed)*volume*MATERIALS[stock.material].density/1000};
}
export const isSolid=(sim,x,y,z,time)=>x>=0&&y>=0&&z>=0&&x<sim.dims[0]&&y<sim.dims[1]&&z<sim.dims[2]&&sim.removedAt[x+sim.dims[0]*(y+sim.dims[1]*z)]>time;
// Outward-wound boundary faces; triangle output is also the exported stock mesh.
const faces=[{n:[-1,0,0],q:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]]},{n:[1,0,0],q:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]},{n:[0,-1,0],q:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]},{n:[0,1,0],q:[[0,1,0],[0,1,1],[1,1,1],[1,1,0]]},{n:[0,0,-1],q:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]},{n:[0,0,1],q:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]}];
export function stockMesh(sim,time){
 const values=[];
 for(let z=0;z<sim.dims[2];z++)for(let y=0;y<sim.dims[1];y++)for(let x=0;x<sim.dims[0];x++){
  if(!isSolid(sim,x,y,z,time))continue;
  for(const f of faces){if(isSolid(sim,x+f.n[0],y+f.n[1],z+f.n[2],time))continue;
   for(const i of [0,1,2,0,2,3])values.push(...[x,y,z].map((v,j)=>sim.min[j]+(v+f.q[i][j])*sim.cell[j]),...f.n);
  }
 }
 return new Float32Array(values);
}
export function exportSTL(sim,time){
 const mesh=stockMesh(sim,time),triangles=mesh.length/18,buffer=new ArrayBuffer(84+triangles*50),v=new DataView(buffer);
 new Uint8Array(buffer,0,80).set(new TextEncoder().encode('CNC Studio 0.7 voxel approximation; mm; stock in work coordinates'));v.setUint32(80,triangles,true);
 for(let i=0;i<triangles;i++){let at=84+i*50;const b=i*18;
  for(let j=0;j<3;j++)v.setFloat32(at+j*4,mesh[b+3+j],true);at+=12;
  for(let k=0;k<3;k++)for(let j=0;j<3;j++)v.setFloat32(at+(k*3+j)*4,mesh[b+k*6+j],true);
 }
 return buffer;
}
export function saveProject(source,setup){return JSON.stringify({format:'cnc-studio-sixaxis',version:1,source,setup:validateSetup(setup)},null,2);}
export function loadProject(text){
 if(text.length>4*1024*1024)throw Error('專案超過 4 MB');const p=JSON.parse(text);
 if(p.format!=='cnc-studio-sixaxis'||p.version!==1||typeof p.source!=='string')throw Error('不相容的六軸專案格式');
 return {source:p.source,setup:validateSetup(p.setup)};
}
