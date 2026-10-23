import {VERSION,DEFAULT_MACHINE,MATERIALS,validateSetup,moveAt,pose,lerp,stockMesh,exportSTL,saveProject,loadProject} from './sixaxis-core.mjs';
import {View3D,lineVertices,boxLines,toolMesh,drawSection,drawGraph} from './sixaxis-view.mjs';
import {callEngine,stopEngine} from './runtime.mjs';
const $=id=>document.getElementById(id);
let catalog,view,worker,program=null,sim=null,time=0,playing=false,previous=0,lastMesh=0,removedTimes=[],nominal=null,comparison=null,stepToken=0,sourceHash='';
const controls=['rewind','prev','play','next','end','timeline','export-stl','export-report'];
const labels={rapid:'快速撞料',holder:'刀把干涉',shank:'刀桿干涉',spindle:'主軸停止',fixture:'夾具包絡',overtravel:'超出行程',overspeed:'軸速超限',rpm:'主軸超速'};
const fmt=n=>n.toLocaleString('en-US',{maximumFractionDigits:1});
const clock=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
function notice(message,error=false){$('status').textContent=message;$('status-dot').className='dot '+(error?'error':'');clearTimeout(notice.timer);$('toast').hidden=!error;if(error){$('toast').textContent=message;notice.timer=setTimeout(()=>$('toast').hidden=true,12000);}}
function vector(id,count){const parts=$(id).value.split(',');if(parts.length!==count||parts.some(x=>!x.trim()))throw Error(`${id} 需要 ${count} 個逗號分隔數值`);return parts.map(Number);}
function settings(){return validateSetup({machine:{...structuredClone(DEFAULT_MACHINE),order:$('order').value,coordinates:$('coordinates').value,limits:JSON.parse($('limits').value),rapid:vector('rapid',6),max_rpm:Number($('max-rpm').value)},initial:vector('initial',6),stock:{size:vector('stock-size',3),min:vector('stock-min',3),resolution:Number($('resolution').value),material:$('material').value},tools:JSON.parse($('tools').value),fixtures:JSON.parse($('fixtures').value),default_tool:$('default-tool').value});}
function writeSettings(s){
 $('order').value=s.machine.order;$('coordinates').value=s.machine.coordinates;$('limits').value=JSON.stringify(s.machine.limits);$('rapid').value=s.machine.rapid.join(',');$('max-rpm').value=s.machine.max_rpm;$('initial').value=s.initial.join(',');$('stock-size').value=s.stock.size.join(',');$('stock-min').value=s.stock.min.join(',');
 if(![...$('resolution').options].some(o=>Number(o.value)===s.stock.resolution)){const op=new Option(String(s.stock.resolution),String(s.stock.resolution));$('resolution').add(op);}
 $('resolution').value=s.stock.resolution;$('material').value=s.stock.material;$('tools').value=JSON.stringify(s.tools,null,2);$('fixtures').value=JSON.stringify(s.fixtures,null,2);toolOptions(s.tools,s.default_tool);
}
function toolOptions(tools,selected){$('default-tool').replaceChildren(...tools.map(t=>new Option(`T${t.number} · ${t.name||t.id}`,t.id)));if(selected)$('default-tool').value=selected;}
function invalidate(message='設定已變更，請重新分析'){
 worker?.terminate();worker=null;program=null;sim=null;comparison=null;playing=false;time=0;removedTimes=[];sourceHash='';controls.forEach(id=>$(id).disabled=true);$('compare').disabled=true;$('comparison').textContent='';$('play').textContent='▶';$('run').disabled=false;$('cancel').hidden=true;$('timeline').value=0;$('line-number').textContent='EDITOR';$('alerts').replaceChildren();$('checks-label').textContent='待分析';$('current-line').textContent='載入 G-code 後，按「分析與除料」';$('time').textContent='00:00 / 00:00';
 for(const id of ['duration','removed','mass','alarm-count'])$(id).textContent='—';
 if(view){for(const name of ['stock','path','rapid','tool','fixtures'])view.set(name,new Float32Array(),[1,1,1,1]);try{const s=settings();view.fit(s.stock);view.set('outline',boxLines(s.stock.min,s.stock.min.map((v,i)=>v+s.stock.size[i])),[.23,.45,.53,1],true);}catch{}view.draw();}
 drawSection($('section'),null,0,'xz',.5);drawGraph($('graph'),null,null,0);$('axes').replaceChildren(...[...'XYZABC'].map(c=>{const el=document.createElement('span');el.textContent=`${c} —`;return el;}));notice(message);
}
function download(data,name,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function currentCount(){let lo=0,hi=removedTimes.length;while(lo<hi){const m=(lo+hi)>>1;if(removedTimes[m]<=time)lo=m+1;else hi=m;}return lo;}
function setTime(value,force=true){if(!program)return;time=Math.max(0,Math.min(program.duration,value));render(force);}
function render(force=false){
 if(!program||!sim)return;
 const p=moveAt(program,time),n=currentCount();$('timeline').value=time/program.duration*1000;$('time').textContent=`${clock(time)} / ${clock(program.duration)}`;$('line-number').textContent=`LINE ${p.move.line}`;$('current-line').textContent=`L${p.move.line} · ${program.source.split('\n')[p.move.line-1]?.trim()||''}`;
 $('axes').replaceChildren(...[...p.xyz,...p.abc].map((v,i)=>{const el=document.createElement('span'),b=document.createElement('b');b.textContent='XYZABC'[i];el.append(b,document.createTextNode(v.toFixed(2)));return el;}));
 $('removed').textContent=`${fmt(n*sim.voxel_mm3)} mm³`;$('mass').textContent=`${fmt((sim.removedAt.length-n)*sim.voxel_mm3*MATERIALS[program.setup.stock.material].density/1000)} g`;
 if(force||performance.now()-lastMesh>160){view.set('stock',stockMesh(sim,time),[...MATERIALS[program.setup.stock.material].color,1]);lastMesh=performance.now();drawSection($('section'),sim,time,$('section-plane').value,Number($('section-depth').value)/100);}
 view.set('tool',toolMesh(p,p.tool,program.setup.machine),[.87,.71,.38,1]);layers();drawGraph($('graph'),program,sim,time);
}
function layers(){if(!view)return;for(const [name,id] of [['stock','show-stock'],['outline','show-stock'],['path','show-path'],['rapid','show-path'],['tool','show-tool'],['fixtures','show-fixture'],['nominal','show-nominal']]){const b=view.buffers.get(name);if(b)b.visible=$(id).checked;}view.draw();}
function selectLine(line){const lines=$('code').value.split('\n'),start=lines.slice(0,line-1).reduce((n,s)=>n+s.length+1,0);$('code').setSelectionRange(start,start+(lines[line-1]?.length||0));$('code').scrollTop=Math.max(0,(line-5)*21.6);}
function showAlerts(){
 $('alerts').replaceChildren();$('checks-label').textContent=`${sim.alerts.length} 則`;$('alarm-count').textContent=String(sim.alerts.length);
 if(!sim.alerts.length){const p=document.createElement('p');p.className='empty';p.textContent='本次取樣未偵測到告警。檢查結果受體素間距、夾具包絡與通用機構假設限制。';$('alerts').append(p);}
 for(const a of sim.alerts.slice(0,500)){const b=document.createElement('button'),title=document.createElement('b');b.className='alert';title.textContent=`${labels[a.kind]||a.kind} · L${a.line} · ${clock(a.time)}`;b.append(title,document.createTextNode(a.detail));b.onclick=()=>{playing=false;$('play').textContent='▶';setTime(a.time);selectLine(a.line);};$('alerts').append(b);}
 if(sim.alerts.length>500){const p=document.createElement('p');p.className='empty';p.textContent='僅顯示前 500 則，完整結果可下載報告。';$('alerts').append(p);}
 for(const text of program.warnings){const p=document.createElement('p');p.className='empty';p.textContent=text;$('alerts').append(p);}
}
function buildScene(){
 view.fit(program.setup.stock);const cut=[],rapid=[];
 for(const m of program.moves){const t=program.setup.tools.find(t=>t.id===m.tool),angle=m.abc_b.reduce((n,v,i)=>n+Math.abs(v-m.abc_a[i]),0),count=Math.max(1,Math.ceil(angle/2));let last=pose(m.a,m.abc_a,t,program.setup.machine).tip;for(let k=1;k<=count;k++){const next=pose(lerp(m.a,m.b,k/count),lerp(m.abc_a,m.abc_b,k/count),t,program.setup.machine).tip;(m.mode==='G0'?rapid:cut).push([last,next]);last=next;}}
 view.set('path',lineVertices(cut),[.21,.87,.76,.85],true);view.set('rapid',lineVertices(rapid),[.95,.62,.3,.5],true);
 const fixtures=program.setup.fixtures.flatMap(f=>[...boxLines(f.min,f.max)]);view.set('fixtures',new Float32Array(fixtures),[.95,.47,.36,1],true);
 $('frame-label').textContent=`G54 · ${program.setup.machine.coordinates.toUpperCase()} · ${program.setup.machine.order==='ZYX'?'Rz Ry Rx':'Rx Ry Rz'}`;
}
async function run(){
 try{const source=$('code').value,setup=settings();invalidate('正在解析與計算立體除料…');$('run').disabled=true;$('cancel').hidden=false;
  const owned=worker=new Worker(new URL('./sixaxis-worker.mjs',import.meta.url),{type:'module'});
  owned.onmessage=async({data})=>{if(worker!==owned)return;if(data.type==='progress'){notice(`立體除料計算 ${Math.round(data.value*100)}%`);return;}worker=null;owned.terminate();$('run').disabled=false;$('cancel').hidden=true;
   if(data.type==='error'){notice(data.message,true);return;}
   program=data.program;sim=data.sim;const currentProgram=program;removedTimes=Array.from(sim.removedAt).filter(Number.isFinite).sort((a,b)=>a-b);time=0;controls.forEach(id=>$(id).disabled=false);$('compare').disabled=!nominal;buildScene();showAlerts();$('duration').textContent=`${fmt(program.duration)} s`;
   notice(sim.alerts.length?'分析完成 · 有待檢查告警':'分析完成 · 未偵測到告警');$('status-dot').className='dot '+(sim.alerts.length?'warn':'ready');render(true);
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));if(program===currentProgram)sourceHash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  };
  owned.onerror=e=>{if(worker===owned){invalidate();notice(`運算執行緒錯誤：${e.message}`,true);}};owned.postMessage({source,setup});
 }catch(e){notice(e.message,true);}
}
function play(){if(!program)return;if(time>=program.duration){time=0;}playing=!playing;$('play').textContent=playing?'Ⅱ':'▶';previous=performance.now();}
function frame(now){if(playing&&program){const next=Math.min(program.duration,time+(now-previous)/1000*Number($('speed').value));const alert=$('stop-alert').checked?sim.alerts.find(a=>a.time>time+1e-7&&a.time<=next):null;time=alert?alert.time:next;if(alert||time>=program.duration){playing=false;$('play').textContent='▶';if(alert)notice(`暫停於 L${alert.line}：${alert.detail}`);}render(false);}previous=now;requestAnimationFrame(frame);}
function step(direction){if(!program)return;playing=false;$('play').textContent='▶';const edges=[0,...program.moves.filter((m,i,all)=>i===all.length-1||all[i+1].line!==m.line).map(m=>m.t1)];const target=direction>0?edges.find(v=>v>time+1e-6):edges.findLast(v=>v<time-1e-6);setTime(target??(direction>0?program.duration:0));}
function cancelComparison(){if(worker?.comparison){worker.terminate();worker=null;$('cancel').hidden=true;$('compare').disabled=!sim||!nominal;}comparison=null;$('comparison').textContent='';}
function nominalView(){if(!nominal||!view)return;try{const offset=vector('step-offset',3);if(offset.some(v=>!Number.isFinite(v)))throw Error('STEP 位移無效');const verts=[];for(const tri of nominal.triangles)for(let k=0;k<3;k++)verts.push([nominal.vertices[tri[k]].map((v,i)=>v+offset[i]),nominal.vertices[tri[(k+1)%3]].map((v,i)=>v+offset[i])]);view.set('nominal',lineVertices(verts),[.6,.45,.92,.5],true);layers();}catch(e){notice(e.message,true);}}
async function loadStep(file){if(!file)return;cancelComparison();const token=++stepToken;try{notice('STEP 幾何核心載入中…');const result=await callEngine('analyze',{bytes:await file.arrayBuffer(),name:file.name});if(token!==stepToken)return;if(!result.model.audit.valid||result.model.audit.solid_count<1)throw Error('STEP 不是有效實體');nominal=result.model;comparison=null;$('comparison').textContent='';$('step-name').textContent=`${file.name} · ${nominal.audit.solid_count} 實體 · ${nominal.triangles.length} 三角形`;$('compare').disabled=!sim;nominalView();notice('STEP 基準已載入，請核對模型位移');}catch(e){if(token===stepToken)notice(e.message,true);}}
function compare(){if(!sim||!nominal)return;try{const offset=vector('step-offset',3);if(offset.some(v=>!Number.isFinite(v)))throw Error('STEP 位移無效');worker?.terminate();const owned=worker=new Worker(new URL('./sixaxis-worker.mjs',import.meta.url),{type:'module'});owned.comparison=true;$('compare').disabled=true;$('cancel').hidden=false;notice('比較 STEP 設計與完工體素…');owned.onmessage=({data})=>{if(worker!==owned)return;owned.terminate();worker=null;$('compare').disabled=false;$('cancel').hidden=true;if(data.type==='error'){notice(data.message,true);return;}comparison=data.comparison;$('comparison').textContent=`體素估算：過切 ${fmt(comparison.overcut_mm3)} mm³；殘料 ${fmt(comparison.residual_mm3)} mm³。${comparison.target_outside_stock?'設計模型部分位於素材外，數值只計素材範圍。':''}`;notice('設計比對完成');};owned.onerror=e=>{owned.terminate();worker=null;$('compare').disabled=false;$('cancel').hidden=true;notice(e.message,true);};owned.postMessage({type:'compare',sim,model:nominal,offset});}catch(e){notice(e.message,true);}}
async function demo(){try{writeSettings({machine:structuredClone(DEFAULT_MACHINE),initial:[-45,0,15,0,0,0],stock:{min:[-40,-25,-24],size:[80,50,24],resolution:1,material:'al6061'},tools:catalog.tools,fixtures:[],default_tool:'em6'});const r=await fetch(new URL('./examples/sixaxis-demo.nc',import.meta.url));if(!r.ok)throw Error('範例檔案讀取失敗');$('code').value=await r.text();$('filename').textContent='sixaxis-demo.nc';invalidate('六軸範例已載入');}catch(e){notice(e.message,true);}}
try{
 const response=await fetch(new URL('./catalog.json',import.meta.url));if(!response.ok)throw Error('刀具庫讀取失敗');catalog=await response.json();view=new View3D($('view3d'));await demo();
 $('run').onclick=run;$('cancel').onclick=()=>invalidate('已取消運算');$('demo').onclick=demo;$('play').onclick=play;$('rewind').onclick=()=>{playing=false;$('play').textContent='▶';setTime(0);};$('end').onclick=()=>{playing=false;$('play').textContent='▶';setTime(program.duration);};$('prev').onclick=()=>step(-1);$('next').onclick=()=>step(1);
 $('timeline').oninput=()=>{playing=false;$('play').textContent='▶';setTime(Number($('timeline').value)/1000*program.duration);};
 $('code').oninput=()=>invalidate();$('setup-inputs').addEventListener('input',()=>invalidate());$('tools').onchange=()=>{try{const old=$('default-tool').value;toolOptions(JSON.parse($('tools').value),old);}catch(e){notice(e.message,true);}};
 $('section-plane').onchange=()=>render(true);$('section-depth').oninput=()=>render(true);$('step-offset').oninput=()=>{cancelComparison();nominalView();};
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view.cameraView(b.dataset.view));$('fit').onclick=()=>{try{view.fit(settings().stock);view.draw();}catch(e){notice(e.message,true);}};document.querySelectorAll('.layerbar input').forEach(e=>e.onchange=layers);
 $('load-nc').onclick=()=>$('nc-file').click();$('load-project').onclick=()=>$('project-file').click();$('load-step').onclick=()=>$('step-file').click();$('step-file').onchange=()=>{loadStep($('step-file').files[0]);$('step-file').value='';};
 $('clear-step').onclick=()=>{cancelComparison();stepToken++;stopEngine();nominal=null;comparison=null;$('compare').disabled=true;$('comparison').textContent='';$('step-name').textContent='尚未載入設計工件';view.set('nominal',new Float32Array(),[1,1,1,1]);view.draw();};$('compare').onclick=compare;
 $('nc-file').onchange=async()=>{const file=$('nc-file').files[0];if(!file)return;try{if(file.size>3*1024*1024)throw Error('NC 檔案上限 3 MB');$('code').value=await file.text();$('filename').textContent=file.name;invalidate('NC 已載入');}catch(e){notice(e.message,true);}$('nc-file').value='';};
 $('project-file').onchange=async()=>{const file=$('project-file').files[0];if(!file)return;try{if(file.size>4*1024*1024)throw Error('專案上限 4 MB');const p=loadProject(await file.text());writeSettings(p.setup);$('code').value=p.source;$('filename').textContent=file.name;invalidate('專案已載入；STEP 基準請另行載入');$('clear-step').click();}catch(e){notice(e.message,true);}$('project-file').value='';};
 $('save-project').onclick=()=>{try{download(saveProject($('code').value,settings()),'CNC_XYZABC_PROJECT.json');notice('已儲存 NC 與設定；STEP 基準檔案另行保留');}catch(e){notice(e.message,true);}};
 $('export-nc').onclick=()=>download($('code').value,'CNC_SOURCE.nc','text/plain');$('export-stl').onclick=()=>download(exportSTL(sim,program.duration),'CNC_XYZABC_VOXEL_APPROX_MM.stl','application/octet-stream');
 $('export-report').onclick=()=>{const report={version:VERSION,created_at:new Date().toISOString(),source_sha256:sourceHash,source:program.source,setup:program.setup,duration_s:program.duration,removed_mm3:sim.removed_mm3,remaining_mm3:sim.remaining_mm3,mass_g:sim.mass_g,voxel_size_mm:sim.cell,samples:sim.samples,alerts:sim.alerts,warnings:program.warnings,arcs:program.arc_summary,comparison:comparison?{...comparison,nominal:undefined,step_sha256:nominal.audit.sha256,offset:vector('step-offset',3)}:null,assumptions:['固定工件與通用 ABC 刀頭；不是特定母機的逆運動學或 RTCP','體素中心取樣；細節與碰撞可能受間距限制','夾具採保守包絡，只能作接近或相交提示','時間無加減速、換刀、M碼延遲；材料僅影響質量估算','未計切削力、偏擺、熱變形；不得當作實機加工核准']};download(JSON.stringify(report,null,2),'CNC_XYZABC_VERIFICATION.json');};
 document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();run();}else if(e.code==='Space'&&!['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement?.tagName)){e.preventDefault();play();}});requestAnimationFrame(frame);
}catch(e){notice(e.message,true);$('run').disabled=true;}
