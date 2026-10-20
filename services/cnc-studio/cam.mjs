// Browser port of the bounded deterministic cam.py. No model emits motion blocks.
const copy=value=>structuredClone(value);
export function number(value,name,lo,hi){
 if(typeof value!=='number'||!Number.isFinite(value)||value<lo||value>hi)throw Error(`${name} 必須介於 ${lo} 與 ${hi}`);
 return value;
}
export function defaultSettings(model){
 const [x,y,z]=model.size;
 return {machine:'vmc400',material:'al6061',tool:'em6',fixture:'vise',stock_x:x,stock_y:y,stock_z:z+1,safe_z:10,stepdown:1,stepover:.4,feed_scale:1,breakthrough:4,fixture_boxes:[],machine_limits:{}};
}
export function validate(model,supplied,catalog){
 const c=copy(supplied);
 for(const [key,group]of Object.entries({machine:'machines',material:'materials',tool:'tools',fixture:'fixtures'}))if(!catalog[group].some(v=>v.id===c[key]))throw Error('未知的 '+key);
 const [x,y,z]=model.size;
 for(const [name,lo,hi]of [['stock_x',x,2000],['stock_y',y,2000],['stock_z',z,1000],['safe_z',2,200],['stepdown',.1,3],['stepover',.1,.65],['feed_scale',.1,1],['breakthrough',0,5]])c[name]=number(c[name],name,lo,hi);
 if(!Array.isArray(c.fixture_boxes)||c.fixture_boxes.length>30)throw Error('治具包絡盒數量不正確');
 for(const b of c.fixture_boxes){if(!Array.isArray(b)||b.length!==6)throw Error('包絡盒需為 6 個座標');b.forEach(v=>number(v,'fixture',-3000,3000));if([0,1,2].some(i=>b[i]>=b[i+3]))throw Error('包絡盒上下限不正確');}
 const m=copy(catalog.machines.find(v=>v.id===c.machine)),o=c.machine_limits||{};
 if(typeof o!=='object'||Array.isArray(o))throw Error('母機能力格式錯誤');
 for(const key of ['rpm','feed','rapid'])if(key in o)m[key]=number(o[key],key,100,60000);
 if('travel'in o){if(!Array.isArray(o.travel)||o.travel.length!==3)throw Error('行程需三個值');m.travel=o.travel.map(v=>number(v,'travel',10,5000));}
 c.resolved_machine=m;return c;
}
export function segmentBox(a,b,box,radius,low,high){
 const lo=[box[0]-radius,box[1]-radius,box[2]-high],hi=[box[3]+radius,box[4]+radius,box[5]-low];let t0=0,t1=1;
 for(let i=0;i<3;i++){const d=b[i]-a[i];if(Math.abs(d)<1e-12){if(a[i]<lo[i]||a[i]>hi[i])return false;}else{const u=(lo[i]-a[i])/d,v=(hi[i]-a[i])/d;t0=Math.max(t0,Math.min(u,v));t1=Math.min(t1,Math.max(u,v));if(t0>t1)return false;}}return true;
}
export function chooseMachine(model,settings,catalog){
 const t=catalog.tools.find(t=>t.id===settings.tool),clearance=Math.max(0,...settings.fixture_boxes.map(b=>b[5]));
 const required=[settings.stock_x+2*(t.diameter+1),settings.stock_y+2*t.diameter,model.size[2]+settings.safe_z+settings.breakthrough+Math.max(...catalog.tools.map(t=>t.length+t.holder_length),clearance)];
 const candidates=catalog.machines.filter(m=>m.travel.every((v,i)=>v>=required[i])).sort((a,b)=>a.travel.reduce((x,y)=>x*y,1)-b.travel.reduce((x,y)=>x*y,1));
 return {machine:candidates[0]?.id||settings.machine,required_mm:required,candidates:candidates.map(m=>m.id),method:'numeric-capacity-rule; not Laya'};
}
export function buildPlan(model,supplied,catalog,strategy='raster'){
 const c=validate(model,supplied,catalog),machine=c.resolved_machine,material=catalog.materials.find(v=>v.id===c.material),tool=catalog.tools.find(v=>v.id===c.tool);
 if(tool.kind!=='endmill')throw Error('面銑／口袋需中心切削平底銑刀');
 if(!['raster','contour'].includes(strategy))throw Error('未支援的策略');
 const [x,y,z]=model.size,allowance=c.stock_z-z,safe=c.safe_z,blockers=[],warnings=[],tasks=[],ops=[],moves=[];
 if(!model.supported)blockers.push(...model.limitations);
 if(Math.abs(c.stock_x-x)>1e-4||Math.abs(c.stock_y-y)>1e-4)blockers.push('第一版未產生外輪廓／底面加工；素材 XY 須預加工至成品外形尺寸。');
 if(safe<=allowance+1)blockers.push('安全 Z 必須比素材頂面至少高 1 mm。');
 if(!c.fixture_boxes.length)warnings.push('未提供治具包絡盒，治具碰撞未驗證。');
 warnings.push('刀路為粗加工草稿；口袋內角保留刀具半徑殘料，未含清角、精加工或公差驗證。','3D／2D 播放刀路及刀具包絡；未執行材料移除、完整機台、換刀或工件碰撞模擬。','FANUC 母機專用後處理、G54、H 補正與換刀動作尚未驗證；不可直接上機。');
 tasks.push({title:'STEP 幾何與加工方向',detail:`單一有效實體檢查、固定 +Z 刀軸；${model.features.length} 個特徵`},{title:'素材與裝夾',detail:`${c.stock_x} × ${c.stock_y} × ${c.stock_z} mm；成品包圍盒左下角 G54，頂面 Z0`});
 let position=[0,0,safe];
 const parameters=t=>{const rpm=Math.min(machine.rpm,material.vc*1000/(Math.PI*t.diameter));return [Math.round(rpm),Math.round(Math.min(machine.feed,rpm*t.flutes*material.fz)*c.feed_scale*10)/10];};
 const add=(mode,p,t,feed,op)=>{p=p.map(v=>Math.round(v*1e4)/1e4);if(p.every((v,i)=>v===position[i]))return;if(moves.length>60000)throw Error('刀路超過 60,000 段，請增加步距');moves.push({a:[...position],b:p,mode,tool:t.id,feed,op});position=p;};
 const begin=(title,t)=>{const [rpm,feed]=parameters(t),op=ops.length;ops.push({id:op,title,tool:t.id,rpm,feed,start:moves.length});tasks.push({title,detail:`T${t.number} Ø${t.diameter} · ${rpm} rpm · ${feed} mm/min`});return [op,feed];};
 const retract=(t,feed,op)=>add('G0',[position[0],position[1],safe],t,feed,op);
 if(model.supported){
  const dz=Math.min(c.stepdown,material.stepdown),radius=tool.diameter/2;
  if(allowance>1e-6){
   const [op,feed]=begin('素材頂面分層面銑',tool),start=-radius-1,end=x+radius+1,rows=Math.max(1,Math.ceil(y/(tool.diameter*c.stepover)));
   for(let layer=1;layer<=Math.ceil(allowance/dz);layer++){const level=Math.max(0,allowance-layer*dz);for(let row=0;row<=rows;row++){const yy=y*row/rows,[a,b]=row%2?[end,start]:[start,end];retract(tool,feed,op);add('G0',[a,yy,safe],tool,feed,op);add('G1',[a,yy,level],tool,feed*.25,op);add('G1',[b,yy,level],tool,feed,op);}}retract(tool,feed,op);
  }
  for(const f of model.features){
   const depth=f.depth;
   if(f.kind==='pocket'){
    if(tool.diameter>=Math.min(f.w,f.h)){blockers.push(`${f.id} 口袋小於刀具可用寬度`);continue;}
    if(depth+allowance>=tool.flute_length){blockers.push(`${f.id} 超出有效刃長`);continue;}
    const [op,feed]=begin(`${f.id} 矩形口袋粗銑`,tool),xmin=f.x+radius,xmax=f.x+f.w-radius,ymin=f.y+radius,ymax=f.y+f.h-radius;
    for(let layer=1;layer<=Math.ceil(depth/dz);layer++){
     const level=-Math.min(depth,layer*dz);retract(tool,feed,op);add('G0',[xmin,ymin,safe],tool,feed,op);add('G1',[xmin,ymin,level+Math.min(dz,.5)],tool,feed*.2,op);add('G1',[xmin,ymin,level],tool,feed*.15,op);
     if(strategy==='contour'){let left=xmin,right=xmax,bottom=ymin,top=ymax;while(left<=right+1e-6&&bottom<=top+1e-6){for(const [xx,yy]of [[left,bottom],[right,bottom],[right,top],[left,top],[left,bottom]])add('G1',[xx,yy,level],tool,feed,op);left+=tool.diameter*c.stepover;right-=tool.diameter*c.stepover;bottom+=tool.diameter*c.stepover;top-=tool.diameter*c.stepover;}}
     const rows=Math.max(1,Math.ceil((ymax-ymin)/(tool.diameter*c.stepover)));
     for(let row=0;row<=rows;row++){const yy=ymin+(ymax-ymin)*row/rows,[a,b]=row%2?[xmax,xmin]:[xmin,xmax];add('G1',[a,yy,level],tool,feed,op);add('G1',[b,yy,level],tool,feed,op);}
     for(const [xx,yy]of [[xmin,ymax],[xmin,ymin],[xmax,ymin],[xmax,ymax],[xmin,ymax]])add('G1',[xx,yy,level],tool,feed,op);retract(tool,feed,op);
    }
   }else if(f.kind==='drill'){
    const drill=catalog.tools.find(t=>t.kind==='drill'&&Math.abs(t.diameter-f.diameter)<.01);
    if(!drill){blockers.push(`${f.id} 缺少 Ø${f.diameter} 配套鑽頭`);continue;}
    if(c.breakthrough<drill.diameter/2/Math.tan(59*Math.PI/180)){blockers.push(`${f.id} 延伸量不足以讓 118 度鑽尖完整通孔`);continue;}
    if(depth+allowance+c.breakthrough>=drill.flute_length){blockers.push(`${f.id} 鑽頭刃長不足`);continue;}
    const [op,feed]=begin(`${f.id} 通孔分層啄鑽`,drill);retract(drill,feed,op);add('G0',[f.x,f.y,safe],drill,feed,op);const bottom=-depth-c.breakthrough;let level=0;
    while(level>bottom){level=Math.max(bottom,level-Math.min(2,drill.diameter*.3));add('G1',[f.x,f.y,level],drill,feed*.3,op);retract(drill,feed,op);}
   }
  }
  if(!moves.length)blockers.push('此素材沒有可支援的加工，未產生刀路。');
 }
 const collisions=[],tools=Object.fromEntries(catalog.tools.map(t=>[t.id,t]));let time=0,cutLength=0;
 let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],maxRadius=0,maxHeight=0;
 for(const [i,m]of moves.entries()){
  const t=tools[m.tool],length=Math.hypot(...m.b.map((v,i)=>v-m.a[i]));time+=length/(m.mode==='G0'?machine.rapid:m.feed);if(m.mode==='G1')cutLength+=length;
  for(let bi=0;bi<c.fixture_boxes.length&&collisions.length<=100;bi++){const b=c.fixture_boxes[bi];if(segmentBox(m.a,m.b,b,t.diameter/2,0,t.length)||segmentBox(m.a,m.b,b,t.holder_diameter/2,t.length,t.length+t.holder_length))collisions.push({move:i,box:bi});}
  for(let a=0;a<3;a++){min[a]=Math.min(min[a],m.a[a],m.b[a]);max[a]=Math.max(max[a],m.a[a],m.b[a]);}maxRadius=Math.max(maxRadius,t.diameter/2);maxHeight=Math.max(maxHeight,t.length+t.holder_length);
 }
 if(collisions.length)blockers.push('刀具／刀柄掃掠包絡與治具盒相交，禁止輸出。');
 if(moves.length&&min.some((v,i)=>max[i]-v+(i<2?2*maxRadius:maxHeight)>machine.travel[i]))blockers.push('刀具掃掠範圍超出母機行程範本；尚未核對實際機械座標極限。');
 return {settings:c,tasks,operations:ops,moves,strategy,blockers:[...new Set(blockers)],warnings,collisions,minutes:Math.round(time*100)/100,cut_mm:Math.round(cutLength*10)/10,status:blockers.length?'BLOCKED':'DRAFT',scope:'Browser exact-BREP gate; bounded three-axis 2.5D roughing only',ai:{status:'RULES_ENGINE',executed:false,review_required:false}};
}
export function gcode(plan,catalog){
 if(plan.blockers.length||!plan.moves.length)throw Error('目前計畫有阻擋項目，不能輸出 NC');
 const tools=Object.fromEntries(catalog.tools.map(t=>[t.id,t])),safe=plan.settings.safe_z;
 const lines=['%','O1001 (CNC STUDIO BROWSER - FANUC DRAFT)',`(PLAN ${plan.id||'LOCAL'})`,`(MATERIAL ${plan.settings.material} - STARTING VALUES ONLY)`,'(ROUGHING ONLY - POCKET CORNER STOCK REMAINS)','(G54 X/Y FINISHED BBOX MIN - FINISHED TOP Z0)','(VERIFY G54 H OFFSETS FIXTURE AND TOOLCHANGE)','G21 G17 G90 G94 G40 G80','G54'];let active=null;
 for(const op of plan.operations){const opMoves=plan.moves.filter(m=>m.op===op.id);if(!opMoves.length)continue;const t=tools[op.tool];if(active!==t.id){if(active!==null)lines.push(`G00 Z${safe.toFixed(4)}`,'M09','M05');lines.push('M00 (MANUALLY VERIFY SAFE TOOLCHANGE POSITION)',`T${String(t.number).padStart(2,'0')} M06`,`G00 G43 H${String(t.number).padStart(2,'0')} Z${safe.toFixed(4)}`,`S${op.rpm} M03`,'M08');active=t.id;}lines.push(`(OP ${op.id+1})`);for(const m of opMoves){let line=`${m.mode} X${m.b[0].toFixed(4)} Y${m.b[1].toFixed(4)} Z${m.b[2].toFixed(4)}`;if(m.mode==='G1')line+=` F${m.feed.toFixed(1)}`;lines.push(line);}}
 lines.push(`G00 Z${safe.toFixed(4)}`,'M09','M05','M30','%');return lines.join('\n')+'\n';
}
