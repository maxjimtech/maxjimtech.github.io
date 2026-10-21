// Browser three-axis surface heightfield screening and ball-nose finish path.
// Geometry is a tessellated approximation of a validated STEP BREP; never a manufacturing release.
import {validate,chooseMachine,inspectMotion,gcode} from './cam.mjs';

const near=(a,b,tolerance=1e-5)=>Math.abs(a-b)<=tolerance;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const round=v=>Math.round(v*1e4)/1e4;

export function surfaceIndex(model){
 if(!model?.audit?.valid||model.audit.solid_count!==1||!Array.isArray(model.vertices)||!Array.isArray(model.triangles))
  throw Error('曲面雕刻要求有效的單一 STEP 封閉實體');
 if((model.features||[]).length)throw Error('曲面模式不支援口袋、孔洞或階梯；請使用 2.5D 模式');
 if(model.triangles.length>100000||model.triangles.length<4)throw Error('曲面網格複雜度不在支援範圍');
 const [sx,sy,sz]=model.size;
 if(![sx,sy,sz].every(v=>finite(v)&&v>0&&v<=2000))throw Error('曲面包圍盒尺寸不正確');
 const binsX=Math.max(8,Math.min(72,Math.ceil(sx/2))),binsY=Math.max(8,Math.min(72,Math.ceil(sy/2)));
 const bins=Array.from({length:binsX*binsY},()=>[]),top=[];
 let projectedArea=0,invalidUnderside=0,tooSteep=0,assignments=0;
 for(const indices of model.triangles){
  const pts=indices.map(i=>model.vertices[i]);
  if(pts.some(p=>!p||p.length!==3||p.some(v=>!finite(v))))throw Error('曲面三角網格有無效節點');
  const [a,b,c]=pts,u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]);
  const nx=u[1]*v[2]-u[2]*v[1],ny=u[2]*v[0]-u[0]*v[2],nz=u[0]*v[1]-u[1]*v[0],norm=Math.hypot(nx,ny,nz);
  if(norm<1e-10)continue;
  const cos=nz/norm;
  if(cos<-.09){
   if(pts.some(p=>!near(p[2],-sz,Math.max(.025,sz*1e-4))))invalidUnderside++;
   continue;
  }
  if(cos<.12){if(cos>.01)tooSteep++;continue;}
  const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
  if(Math.abs(denominator)<1e-10)continue;
  const xmin=Math.max(0,Math.min(a[0],b[0],c[0])),xmax=Math.min(sx,Math.max(a[0],b[0],c[0]));
  const ymin=Math.max(0,Math.min(a[1],b[1],c[1])),ymax=Math.min(sy,Math.max(a[1],b[1],c[1]));
  projectedArea+=Math.abs(nz)/2;
  const triangle={p:pts,denominator,xmin,xmax,ymin,ymax};
  const index=top.push(triangle)-1;
  const ix0=Math.max(0,Math.floor(xmin/sx*binsX)-1),iy0=Math.max(0,Math.floor(ymin/sy*binsY)-1);
  const ix1=Math.min(binsX-1,Math.floor(xmax/sx*binsX)+1),iy1=Math.min(binsY-1,Math.floor(ymax/sy*binsY)+1);
  for(let iy=iy0;iy<=iy1;iy++)for(let ix=ix0;ix<=ix1;ix++){
   bins[iy*binsX+ix].push(index);
   if(++assignments>1800000)throw Error('曲面三角形空間索引過大');
  }
 }
 if(invalidUnderside||tooSteep)throw Error('曲面含下表面斜面、倒扣或近垂直斜坡，不適合 +Z 球刀雕刻');
 if(!top.length||Math.abs(projectedArea-sx*sy)>sx*sy*.015)throw Error('曲面向上投影未完整涵蓋矩形素材，可能有孔洞或倒扣');
 function at(x,y){
  if(x< -1e-6||x>sx+1e-6||y< -1e-6||y>sy+1e-6)return null;
  const ix=Math.min(binsX-1,Math.max(0,Math.floor(x/sx*binsX))),iy=Math.min(binsY-1,Math.max(0,Math.floor(y/sy*binsY)));
  let found=null;
  for(const id of bins[iy*binsX+ix]){
   const {p,denominator,xmin,xmax,ymin,ymax}=top[id];
   if(x<xmin-1e-6||x>xmax+1e-6||y<ymin-1e-6||y>ymax+1e-6)continue;
   const [a,b,c]=p;
   const wa=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/denominator;
   const wb=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/denominator;
   const wc=1-wa-wb;
   if(Math.min(wa,wb,wc)<-1e-6||Math.max(wa,wb,wc)>1+1e-6)continue;
   const z=wa*a[2]+wb*b[2]+wc*c[2];
   if(found!==null&&Math.abs(found-z)>.08)throw Error('同一 XY 存在不同表面高度（倒扣或階梯），曲面雕刻禁止輸出');
   found=found===null?z:Math.max(found,z);
  }
  return found;
 }
 let lowest=Infinity,highest=-Infinity,maxJump=0;
 const steps=20,samples=Array.from({length:steps+1},()=>[]);
 for(let iy=0;iy<=steps;iy++)for(let ix=0;ix<=steps;ix++){
  const z=at(sx*ix/steps,sy*iy/steps);
  if(z===null)throw Error('曲面高度場缺少掃描點；僅支援完整覆蓋矩形 XY 的上表面');
  lowest=Math.min(lowest,z);highest=Math.max(highest,z);
  if(ix)maxJump=Math.max(maxJump,Math.abs(z-samples[iy][ix-1]));
  if(iy)maxJump=Math.max(maxJump,Math.abs(z-samples[iy-1][ix]));
  samples[iy][ix]=z;
 }
 const maxAllowedStep=Math.max(sx,sy)/steps*3;
 if(maxJump>maxAllowedStep)throw Error('曲面高度跳變過大；不支援垂直階梯或局部深腔');
 return {at,summary:{supported:true,mode:'heightfield_3axis',sampling:'BREP triangulation; not exact tool surface intersection',
  triangles:top.length,mesh_deflection_mm:Math.max(.12,Math.max(...model.size)/400),lowest_z:round(lowest),highest_z:round(highest),
  projected_xy_area_mm2:round(projectedArea),top_z_reference:'G54 Z0 = STEP bbox top'}};
}

export function inspectSurface(model){
 try{return surfaceIndex(model).summary;}
 catch(error){return {supported:false,mode:'heightfield_3axis',reason:String(error?.message||error)};}
}

export function toolTipHeight(index,x,y,r,extra){
 if(!finite(r)||r<=0||r>30||!finite(extra)||extra<0||extra>2)throw Error('球刀與曲面預留量不正確');
 const steps=Math.max(6,Math.ceil(r/.42)),sampleStep=r/steps;
 let tip=-Infinity,hits=0;
 for(let iy=-steps;iy<=steps;iy++)for(let ix=-steps;ix<=steps;ix++){
  const dx=ix*sampleStep,dy=iy*sampleStep,d2=dx*dx+dy*dy;
  if(d2>r*r+1e-7)continue;
  const z=index.at(x+dx,y+dy);
  if(z===null)continue;
  tip=Math.max(tip,z+Math.sqrt(Math.max(0,r*r-d2))-r);hits++;
 }
 if(!hits)throw Error('球刀足跡超出曲面 XY 覆蓋範圍');
 return round(tip+extra);
}

export function buildSurfacePlan(model,input,catalog,surfaceOptions={}){
 // Recreate the spatial index and screen the STEP-derived mesh on every plan.
 const index=surfaceIndex(model),c=validate(model,input,catalog);
 const machine=c.resolved_machine,t=catalog.tools.find(x=>x.id===c.tool),material=catalog.materials.find(x=>x.id===c.material);
 if(t.kind!=='ballmill')throw Error('曲面雕刻只能使用球頭銑刀');
 const stepover=surfaceOptions.stepover_mm??.9,sample=surfaceOptions.sample_mm??1;
 const finish=surfaceOptions.finish_allowance_mm??.15;
 if(!finite(stepover)||stepover<.3||stepover>t.diameter*.4)throw Error('曲面行距需介於 0.3 mm 與刀徑 40%');
 if(!finite(sample)||sample<.35||sample>1.5)throw Error('曲面刀路取樣需介於 0.35–1.5 mm');
 if(!finite(finish)||finish<0||finish>1)throw Error('曲面預留量需介於 0–1 mm');
 const margin=t.diameter/2+.5,[sx,sy,sz]=model.size;
 if(sx<=margin*2||sy<=margin*2)throw Error('曲面小於球刀安全工作範圍');
 const blockers=[],warnings=['曲面使用 STEP BREP 網格高度場取樣；不是精確刀具／曲面接觸計算。',
  '本版僅對已預粗加工、全表面剩餘材料厚度不超過 0.5 mm 的工件提供精修草稿；未模擬材料移除。',
  '未完整檢查工件及機台的球刀／刀柄、機械座標與換刀碰撞；請在 CAM 校對與實機空跑後使用。'];
 if(!surfaceOptions.pre_roughed)blockers.push('尚未確認已預粗加工（全表面餘量 ≤0.5 mm），禁止匯出曲面 NC。');
 if(Math.abs(c.stock_x-sx)>1e-4||Math.abs(c.stock_y-sy)>1e-4)blockers.push('曲面雕刻要求素材 XY 預先加工至成品包圍盒。');
 if(c.safe_z<=c.stock_z-sz+1)blockers.push('安全 Z 必須高於素材頂面至少 1 mm。');
 if(t.flute_length<=-index.summary.lowest_z+c.stock_z-sz)blockers.push('球刀有效刃長不足以抵達曲面最低點。');
 if(!c.fixture_boxes.length)warnings.push('治具包絡盒未設定，裝夾碰撞未驗證。');
 const surfaceExtra=finish+Math.max(.4,index.summary.mesh_deflection_mm*2),radius=t.diameter/2;
 const rpm=Math.round(Math.min(machine.rpm,material.vc*1000/(Math.PI*t.diameter)));
 const feed=Math.round(Math.min(machine.feed,rpm*t.flutes*material.fz)*c.feed_scale*10)/10;
 const op={id:0,title:'三軸球刀曲面等高掃描精修',tool:t.id,rpm,feed,start:0};
 const tasks=[{title:'曲面 STEP 與 +Z 加工方向',detail:`單一有效實體、完整 XY 高度場；${index.summary.triangles} 個向上三角形`},
  {title:'已預粗加工與安全間隙',detail:`請確認表面餘量 ≤0.5 mm；刀尖預留 ${finish.toFixed(2)} + 網格保守補償 ${Math.max(.4,index.summary.mesh_deflection_mm*2).toFixed(2)} mm`},
  {title:'球刀曲面往復精修',detail:`T${t.number} Ø${t.diameter} 球刀 · 行距 ${stepover} mm · 採樣 ${sample} mm · ${rpm} rpm · ${feed} mm/min`}];
 // Start at known XY origin at safe Z so the exported NC explicitly traverses to the first cut.
 const moves=[],safe=c.safe_z;let point=[0,0,safe];
 const add=(mode,xyz,moveFeed)=>{
  const b=xyz.map(round);
  if(b.every((v,i)=>v===point[i]))return;
  if(moves.length>=60000)throw Error('曲面刀路超過 60,000 段，請增加行距與取樣距離');
  moves.push({a:[...point],b,mode,tool:t.id,feed:moveFeed,op:0});point=b;
 };
 // One continuous G1 lane per row; G0 XY transitions only at clearance Z.
 const rows=Math.max(1,Math.ceil((sy-2*margin)/stepover)),cols=Math.max(1,Math.ceil((sx-2*margin)/sample));
 if((rows+1)*(cols+1)>45000)throw Error('曲面路徑過長，請增加行距或取樣');
 for(let iy=0;iy<=rows;iy++){
  const y=margin+(sy-2*margin)*iy/rows;
  const sign=iy%2?-1:1;
  const startX=sign===1?margin:sx-margin;
  add('G0',[point[0],point[1],safe],feed);
  add('G0',[startX,y,safe],feed);
  for(let ix=0;ix<=cols;ix++){
   const x=margin+(sx-2*margin)*(sign===1?ix:cols-ix)/cols;
   const z=toolTipHeight(index,x,y,radius,surfaceExtra);
   if(ix===0)add('G1',[x,y,z],feed*.2);
   else add('G1',[x,y,z],feed);
  }
  add('G0',[point[0],point[1],safe],feed);
 }
 const audit=inspectMotion(moves,c,catalog);
 blockers.push(...audit.blockers);
 if(blockers.length)warnings.push('含阻擋項目，3D／2D 可預覽，但禁止 G-code 匯出。');
 const plan={settings:c,strategy:'surface_raster',surface_settings:{...surfaceOptions,stepover_mm:stepover,sample_mm:sample,
  finish_allowance_mm:finish,mesh_allowance_mm:surfaceExtra-finish,unmachined_border_mm:margin},
  surface_index:index.summary, tasks,operations:[op],moves,blockers:[...new Set(blockers)],warnings,collisions:audit.collisions,
  minutes:Math.round(audit.minutes*100)/100,cut_mm:Math.round(audit.cut_mm*10)/10,
  status:blockers.length?'BLOCKED':'DRAFT',scope:'Three-axis sampled surface heightfield ball-nose finishing; pre-roughed stock; engineering draft',
  ai:{status:'RULES_ENGINE',executed:false,review_required:false,message:'曲面安全路徑由確定性高度場規則計算。'}};
 return plan;
}
