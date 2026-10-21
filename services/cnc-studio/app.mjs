import {browserAPI,callEngine,stopEngine} from './runtime.mjs';
import {runLite,stopLite} from './lite-runtime.mjs';
import {applyLiteAdvice,confirmLiteReview} from './decision-lite.mjs';
import {renderStock,simulationFrame} from './stock-view.mjs';
import {stockAsSTL} from './stock-stl.mjs';
const APP_VERSION='0.6.0';
let ncURL=null;
'use strict';
const $=id=>document.getElementById(id);
let model=null,plan=null,catalog=null,simulation=null,gcodeSource='',view='3d',yaw=-.65,pitch=.72,zoom=1,playing=false,elapsed=0,last=0,durations=[],total=0,busy=false;
let roughTool='em6';
const canvas=$('scene'),ctx=canvas.getContext('2d');
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6000);}
async function api(path,body,headers){return browserAPI(path,body,headers);}
async function job(path,body,headers){
 if(path==='/api/plan')return callEngine('plan',{model,settings:body.settings,auto_machine:body.auto_machine,strategy:$('strategy').value});
 return browserAPI(path,body,headers);
}
function isGcodeMode(){return $('source_mode').value==='gcode';}
function setBusy(value,label){
 busy=value;$('fields').disabled=value||!model;$('cancel').hidden=!value;
 $('source_mode').disabled=value;
 $('gcode-form').querySelectorAll('input,select').forEach(field=>field.disabled=value);
 for(const id of ['upload','demo','surface-demo','gcode-upload','gcode-demo','gcode-start'])$(id).disabled=value;
 $('plan').textContent=value?label:'規劃製程與產生刀路 →';
 if(value)$('gcode-start').textContent=label;else $('gcode-start').textContent='解析 G-code 並模擬除料 →';
}
function clearPlan(){if(ncURL){URL.revokeObjectURL(ncURL);ncURL=null;}
 $('ai-title').textContent='等待重新規劃';$('ai-detail').textContent='參數變更後需重新計算幾何規則與刀路。';$('ai-confidence').replaceChildren();$('confirm-ai').hidden=true;
 simulation=null;plan=null;playing=false;elapsed=0;$('play').disabled=true;$('play').textContent='▶';$('download').removeAttribute('href');$('download').classList.add('disabled');$('download').setAttribute('aria-disabled','true');
 $('export').disabled=true;$('code-toggle').disabled=true;$('simulate-plan').disabled=true;$('sim-final').disabled=true;$('export-stl').disabled=true;$('reference-label').hidden=true;$('material-summary').hidden=true;
 $('status').textContent='待規劃';$('distance').textContent='—';$('time').textContent='—';$('timeline').value=0;$('progress').textContent='0%';$('tasks').replaceChildren();draw();
}
function labelOptions(id,items){$(id).replaceChildren(...items.map(item=>{let option=document.createElement('option');option.value=item.id;option.textContent=item.name;return option;}));}
function machineFields(){const m=catalog.machines.find(m=>m.id===$('machine').value);['x','y','z'].forEach((v,i)=>$('travel_'+v).value=m.travel[i]);$('rpm_limit').value=m.rpm;$('feed_limit').value=m.feed;}
function toolInfo(){const t=catalog?.tools.find(t=>t.id===$('tool').value);if(t)$('toolinfo').textContent=`T${t.number} · Ø${t.diameter} mm · 有效刃長 ${t.flute_length} mm · 伸出 ${t.length} mm · 刀柄 Ø${t.holder_diameter} mm。`+(t.kind==='ballmill'?'用於 +Z 可達曲面／孔槽精修，保留未加工邊界。':'通孔依孔徑自動配對目錄鑽頭。');}
function surfaceMode(){return $('machining_mode').value==='surface';}
function showModelReview(){
 if(!model)return;
 const surface=surfaceMode(),ok=surface?model.surface?.supported:model.supported;
 $('modelstate').textContent=ok?(surface?'整合高度場可規劃 · +Z 三軸':'2.5D 幾何已辨識 · +Z 加工'):'目前模式僅供預覽 · 不支援此加工';
 $('featurecount').textContent=surface?(model.surface?.supported?'曲面／孔槽':'—'):model.features.length;
 $('review').replaceChildren();
 if(surface)reviewLine(ok?`STEP 單實體 +Z 可達高度場通過；${model.surface.triangles} 個上表面三角形，Z 最低 ${model.surface.lowest_z.toFixed(3)} mm，通底／外形空白取樣 ${model.surface.void_sample_pct}% 。`:`整合高度場阻擋：${model.surface?.reason||'無法辨識 +Z 可達表面'}`,!ok);
 else reviewLine(ok?`WASM BREP 精確支援檢查通過；重建體積差 ${model.difference_mm3.toFixed(5)} mm³。`:model.limitations.join(' '),!ok);
 reviewLine('座標為成品包圍盒 X/Y 最小值、頂面 Z0；刀軸固定 +Z。原始 STEP 不會改寫。');
 if(surface)reviewLine('可整合曲面、凸台、平面盲孔／通孔投影與深槽；倒扣、側孔、封閉內腔仍不支援。');
}
function updateMode(){
 const surface=surfaceMode();
 $('surface-options').hidden=!surface;$('rough-options').hidden=surface;$('rough-parameters').hidden=surface;
 $('surface-status').textContent=!model?'整合高度場支援狀態：尚未載入 STEP':model.surface?.supported?
  `整合高度場：+Z 可達 · ${model.surface.triangles} 面 · 最低 Z ${model.surface.lowest_z.toFixed(2)} mm`:
  `整合高度場不支援：${model.surface?.reason||'未辨識到 +Z 可達表面'}`;
 $('use_lite').disabled=surface;$('lite-label').title=surface?'曲面模式僅由確定性幾何規則決策':'';
 if(surface)$('use_lite').checked=false;
 if(catalog){
  const tools=catalog.tools.filter(t=>t.kind===(surface?'ballmill':'endmill'));
  labelOptions('tool',tools);
  $('tool').value=surface?'ball6':roughTool;
  if(!$('tool').value)$('tool').selectedIndex=0;
  $('tool-label').firstChild.textContent=surface?'精修球頭銑刀':'口袋／面銑刀';
  toolInfo();
 }
 showModelReview();
}
function readSettings(){let settings={};for(const key of ['machine','material','tool','fixture'])settings[key]=$(key).value;for(const key of ['stock_x','stock_y','stock_z','safe_z','stepdown','stepover','feed_scale','breakthrough']){settings[key]=Number($(key).value);if(!Number.isFinite(settings[key]))throw Error(key+' 格式錯誤');}try{settings.fixture_boxes=JSON.parse($('fixture_boxes').value);}catch{throw Error('治具包絡盒需為有效 JSON 陣列');}settings.machine_limits=$('auto_machine').checked?{}:{travel:['x','y','z'].map(v=>Number($('travel_'+v).value)),rpm:Number($('rpm_limit').value),feed:Number($('feed_limit').value)};return settings;}
function readGcodeStock(){
 const stock={x:Number($('gcode-stock_x').value),y:Number($('gcode-stock_y').value),z:Number($('gcode-stock_z').value),top_z:Number($('gcode-top_z').value),resolution_mm:Number($('gcode-resolution').value),material:$('gcode-material').value,
  initial_x:Number($('gcode-initial_x').value),initial_y:Number($('gcode-initial_y').value),initial_z:Number($('gcode-initial_z').value)};
 if(Object.entries(stock).some(([k,v])=>k!=='material'&&!Number.isFinite(v)))throw Error('素材尺寸與網格參數必須是有效數字');
 return stock;
}
function attachSimulation(result){
 simulation=result;
 $('material-summary').hidden=false;
 $('material-summary').textContent=`網格 ${simulation.nx} × ${simulation.ny} · 已除料 ${Math.round(simulation.removed_mm3).toLocaleString()} mm³（${(100-simulation.remaining_pct).toFixed(1)}%） · 剩餘 ${Math.round(simulation.remaining_mm3).toLocaleString()} mm³ · 估計除料質量 ${simulation.removed_mass_g.toFixed(1)} g`;
 $('sim-final').disabled=false;$('export-stl').disabled=false;$('simulate-plan').disabled=true;
 $('reference-label').hidden=isGcodeMode()||!model;$('empty').hidden=true;
 draw();
}
function acceptModel(result){model=result.model;clearPlan();for(const [key,value] of Object.entries(result.settings)){if($(key)&&typeof value!=='object')$(key).value=value;}$('fixture_boxes').value='[]';$('pre_roughed').checked=false;$('filename').textContent=model.name;$('empty').hidden=true;$('geometry').textContent=model.size.map(v=>v.toFixed(2)).join(' × ')+' mm · 1 SOLID · G54 TOP Z0';yaw=-.65;pitch=.72;zoom=1;machineFields();updateMode();draw();}
async function importFile(file){if(!file||busy)return;clearPlan();setBusy(true,'讀取 STEP 幾何…');try{acceptModel(await job('/api/upload',file,{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)}));toast('STEP 已載入');}catch(e){toast(e.message);}finally{setBusy(false);$('file').value='';}}
$('upload').onclick=()=>$('file').click();$('file').onchange=()=>importFile($('file').files[0]);$('upload').ondragover=e=>e.preventDefault();$('upload').ondrop=e=>{e.preventDefault();importFile(e.dataTransfer.files[0]);};
$('demo').onclick=async()=>{setBusy(true,'在 WASM 讀取實際範例 STEP…');try{acceptModel(await job('/api/demo',{}));toast('範例工件已載入');}catch(e){toast(e.message);}finally{setBusy(false);}};
$('surface-demo').onclick=async()=>{setBusy(true,'在 WASM 讀取凹弧曲面 STEP…');try{acceptModel(await job('/api/surface-demo',{}));$('machining_mode').value='surface';updateMode();toast('曲面 STEP 已載入；可直接建立平刀粗加工＋球刀精修整合刀路');}catch(e){toast(e.message);}finally{setBusy(false);}};
$('source_mode').onchange=()=>{
 if(busy)return;
 clearPlan();const importing=isGcodeMode();
 $('step-source').hidden=importing;$('setup').hidden=importing;$('gcode-form').hidden=!importing;
 $('empty').hidden=!importing&&!!model;
 if(importing){$('modelstate').textContent='等待 G-code 與素材設定';$('geometry').textContent='匯入 .nc / .tap / .gcode，再計算 XY 高度網格除料';$('featurecount').textContent='—';$('review').replaceChildren();reviewLine('將以匯入 G-code 的刀具移動，逐步移除設定的虛擬素材。');}
 else updateMode();
 draw();
};
$('gcode-upload').onclick=()=>$('gcode-file').click();
$('gcode-file').onchange=async()=>{
 const f=$('gcode-file').files[0];if(!f||busy)return;
 try{
  clearPlan();if(f.size>3*1024*1024)throw Error('G-code 大於 3 MB');
  gcodeSource=await f.text();if(!gcodeSource.trim())throw Error('G-code 檔案為空');
  $('gcode-name').textContent=f.name;clearPlan();toast('G-code 已讀取；設定材料與素材後開始除料模擬');
 }catch(e){gcodeSource='';$('gcode-name').textContent='匯入 CNC G-code';toast(e.message);}finally{$('gcode-file').value='';}
};
$('gcode-demo').onclick=async()=>{
 try{clearPlan();const res=await fetch(new URL('./examples/arc-removal-demo.nc',import.meta.url));if(!res.ok)throw Error('G-code 範例不存在');
  gcodeSource=await res.text();$('gcode-name').textContent='arc-removal-demo.nc';clearPlan();toast('FANUC G02／G03 圓弧除料範例已讀取');
 }catch(e){gcodeSource='';$('gcode-name').textContent='匯入 CNC G-code';toast(e.message);}
};
$('gcode-form').onsubmit=async e=>{
 e.preventDefault();if(busy)return;
 try{
  if(!gcodeSource.trim())throw Error('請先匯入 G-code 或載入範例');
  const stock=readGcodeStock(),tool=$('gcode-tool').value;
  clearPlan();setBusy(true,'正在解析 G-code 並計算虛擬除料…');
  const result=await callEngine('gcodeImport',{text:gcodeSource,stock,tool,machine:$('gcode-machine').value});
  acceptPlan(result.plan);attachSimulation(result.simulation);
  $('modelstate').textContent='G-code 刀路與素材除料模擬';
  $('geometry').textContent=`${stock.x} × ${stock.y} × ${stock.z} mm · ${result.plan.moves.length.toLocaleString()} 段 · ${stock.material}`;
  $('featurecount').textContent=`${result.plan.operations.length} 刀`;
  toast(`G-code 已解析；移除約 ${Math.round(result.simulation.removed_mm3).toLocaleString()} mm³ 素材`);
 }catch(error){toast('G-code 模擬失敗：'+error.message);}
 finally{setBusy(false);}
};
$('gcode-form').addEventListener('input',e=>{if(e.target.id!=='gcode-file'&&plan)clearPlan();});
function reviewLine(text,block=false){const row=document.createElement('div');row.className='review-line'+(block?' block':'');const icon=document.createElement('em');icon.textContent=block?'!':'·';const content=document.createElement('span');content.textContent=text;row.append(icon,content);$('review').append(row);}
function acceptPlan(result){plan=result;elapsed=0;playing=false;$('play').textContent='▶';$('play').disabled=!plan.moves.length;$('export').disabled=false;$('status').textContent=plan.status==='BLOCKED'?'已阻擋':plan.source==='IMPORTED_GCODE'?'G-code 已讀入':'NC 草稿';$('time').textContent=plan.minutes.toFixed(1);$('distance').textContent=Math.round(plan.cut_mm).toLocaleString();$('review').replaceChildren();plan.blockers.forEach(t=>reviewLine(t,true));plan.warnings.forEach(t=>reviewLine(t));if(!plan.blockers.length)reviewLine(plan.source==='IMPORTED_GCODE'?'已完成支援指令解析，可檢視虛擬除料結果；仍須專業 CAM 校對。':'已通過本版支援範圍與已設定包絡檢查；仍為工程草稿，實機須進行獨立校對。');$('tasks').replaceChildren(...plan.tasks.map((task,i)=>{const row=document.createElement('div');row.className='task';const num=document.createElement('span');num.className='task-num';num.textContent=String(i+1).padStart(2,'0');const div=document.createElement('div'),b=document.createElement('b'),p=document.createElement('p');b.textContent=task.title;p.textContent=task.detail;div.append(b,p);row.append(num,div);return row;}));
 $('confirm-ai').hidden=!plan.ai_review_blocker||!!plan.ai.user_reviewed_at; const ai=plan.ai;$('ai-title').textContent=ai.status==='RULES_ENGINE'?'瀏覽器規則規劃已完成':'MiniLM 建議已完成';$('ai-detail').textContent=ai.status==='MODEL_RESULT'?(ai.user_reviewed_at?'已記錄建議確認；機台適配仍須驗證。':'MiniLM 語意相似度不是信心機率；請核對實際母機、刀具及策略。'):ai.message||'本次僅使用確定性幾何規則。';$('ai-confidence').replaceChildren();if(ai.answers){for(const [key,answer]of Object.entries(ai.answers)){const div=document.createElement('div');div.className='confidence';div.textContent=`${key}: ${answer.choice} · ${answer.similarity===null?'唯一合格選項':`語意相似度 ${answer.similarity.toFixed(3)}`}`;$('ai-confidence').append(div);}}
 if(!plan.blockers.length&&plan.moves.length){if(ncURL)URL.revokeObjectURL(ncURL);ncURL=URL.createObjectURL(new Blob([plan.nc],{type:'text/plain'}));$('download').href=ncURL;$('download').download=plan.source==='IMPORTED_GCODE'?'IMPORTED_GCODE_SOURCE.nc':plan.strategy==='surface_raster'?'O1001_FANUC_SURFACE_DRAFT.nc':'O1001_FANUC_BROWSER_DRAFT.nc';$('download').classList.remove('disabled');$('download').setAttribute('aria-disabled','false');$('code-toggle').disabled=false;}
 if(!isGcodeMode()){$('machine').value=plan.settings.machine;$('tool').value=plan.settings.tool;if(plan.strategy!=='surface_raster')$('strategy').value=plan.strategy;toolInfo();}
 const m=plan.settings.resolved_machine;
 if(!isGcodeMode()){['x','y','z'].forEach((v,i)=>$('travel_'+v).value=m.travel[i]);$('rpm_limit').value=m.rpm;$('feed_limit').value=m.feed;}
 $('simulate-plan').disabled=isGcodeMode()||!model||!plan.moves.length;
 total=0;durations=plan.moves.map(move=>{const length=Math.hypot(...move.b.map((v,i)=>v-move.a[i]));const seconds=60*length/(move.mode==='G0'?m.rapid:move.feed);const segment={start:total,end:total+seconds};total+=seconds;return segment;});$('timeline').value=0;draw();}
$('setup').onsubmit=async e=>{
 e.preventDefault();if(busy||!model||isGcodeMode())return;
 try{
  const settings=readSettings(),surface=surfaceMode(),lite=!surface&&$('use_lite').checked,auto=$('auto_machine').checked;
  clearPlan();setBusy(true,lite?'載入 MiniLM／分析允許的母機與刀具…':'計算刀路…');
  let draftSettings=settings,autoForCam=auto,strategy=$('strategy').value,advice;
  if(lite){
   const featuresOnly={supported:model.supported,size:model.size,features:model.features};
   advice=await runLite({model:featuresOnly,settings,catalog,auto_machine:auto},message=>$('plan').textContent=message);
   draftSettings={...settings,tool:advice.answers.tool.choice};
   if(auto)draftSettings.machine=advice.answers.machine.choice;
   strategy=advice.answers.strategy.choice;
   autoForCam=false; // AI suggestions already passed the numeric candidate gates.
  }
  const surfaceOptions={stepover_mm:Number($('surface_stepover').value),sample_mm:Number($('surface_sample').value),finish_allowance_mm:Number($('surface_allowance').value),rough_allowance_mm:Number($('surface_rough_allowance').value),rough_tool:$('surface-rough-tool').value,pre_roughed:$('pre_roughed').checked};
  const result=await callEngine(surface?'surfacePlan':'plan',{model,settings:draftSettings,auto_machine:autoForCam,strategy,surface:surfaceOptions});
  if(lite)applyLiteAdvice(result,advice); // Always require human review; do not generate NC yet.
  acceptPlan(result);
  toast(result.blockers.length?'計畫含待審查或阻擋項目，請檢視加工檢查':'刀路已產生，可播放及下載草稿');
 }catch(e){toast('規劃失敗：'+e.message+(surfaceMode()?'；請檢查曲面支援狀態及球刀參數':'；可取消 MiniLM 改用規則規劃'));}
 finally{setBusy(false);}
};
$('setup').addEventListener('input',e=>{if(e.target.id==='feed_scale')$('feedvalue').textContent=Math.round(Number(e.target.value)*100)+'%';if(plan)clearPlan();draw();});
$('machining_mode').onchange=()=>{clearPlan();updateMode();};
$('machine').onchange=machineFields;$('tool').onchange=()=>{if(!surfaceMode())roughTool=$('tool').value;toolInfo();};
$('material').onchange=()=>{const m=catalog.materials.find(m=>m.id===$('material').value);$('stepdown').value=m.stepdown;};
$('confirm-ai').onclick=()=>{if(!plan)return;try{acceptPlan(confirmLiteReview(plan,catalog));toast('已記錄 MiniLM 建議確認；任何其他阻擋仍然有效');}catch(e){toast(e.message);}};
$('simulate-plan').onclick=async()=>{
 if(busy||!plan||!model||isGcodeMode())return;
 try{
  const stock={x:plan.settings.stock_x,y:plan.settings.stock_y,z:plan.settings.stock_z,top_z:plan.settings.stock_z-model.size[2],resolution_mm:1,material:plan.settings.material};
  setBusy(true,'計算素材除料與加工後工件…');
  const result=await callEngine('stockSimulation',{plan,stock});
  attachSimulation(result.simulation);
  result.simulation.warnings.forEach(w=>reviewLine(w));
  toast('除料完成形狀已建立；可拖動時間軸或檢視最後成品');
 }catch(error){toast('除料模擬失敗：'+error.message);}
 finally{setBusy(false);}
};
$('sim-final').onclick=()=>{
 if(!simulation||!plan)return;
 playing=false;$('play').textContent='▶';elapsed=total;
 $('status').textContent='除料後工件';draw();
};
$('export-stl').onclick=()=>{
 if(!simulation)return;
 try{const mesh=stockAsSTL(simulation),href=URL.createObjectURL(new Blob([mesh.buffer],{type:'model/stl'}));
  const a=document.createElement('a');a.href=href;a.download='CNC_REMOVED_STOCK_APPROX.stl';a.click();setTimeout(()=>URL.revokeObjectURL(href),3000);
  toast(`近似 STL 已建立（${mesh.triangles.toLocaleString()} 三角形），請勿作為精確 CAD／製造放行模型`);
 }catch(error){toast('近似 STL 匯出失敗：'+error.message);}
};
$('export').onclick=()=>{
 if(!plan)return;
 const modelInfo=model&&!isGcodeMode()?{name:model.name,sha256:model.audit.sha256,size:model.size,features:model.features,surface:model.surface,frame:model.frame}:null;
 const simInfo=simulation?{...simulation,frames:undefined,final_heights_mm:Array.from(simulation.frames.at(-1).heights)}:null;
 const blob=new Blob([JSON.stringify({schema:2,version:APP_VERSION,model:modelInfo,plan,simulation:simInfo},null,2)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='CNC_workorder_'+plan.id.slice(0,8)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('code-toggle').onclick=async()=>{try{const res=await fetch(ncURL);if(!res.ok)throw Error('輸出已被阻擋');$('code').textContent=await res.text();$('code-dialog').showModal();}catch(e){toast(e.message);}};$('close-code').onclick=()=>$('code-dialog').close();
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-selected',String(b===button));});draw();});
$('reset').onclick=()=>{yaw=-.65;pitch=.72;zoom=1;draw();};$('show_stock').onchange=draw;$('show_path').onchange=draw;$('show_reference').onchange=draw;
$('play').onclick=()=>{if(!plan)return;if(elapsed>=total)elapsed=0;playing=!playing;$('play').textContent=playing?'Ⅱ':'▶';last=performance.now();};$('timeline').oninput=()=>{playing=false;$('play').textContent='▶';elapsed=Number($('timeline').value)/1000*total;draw();};
let drag=null;canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};canvas.onpointerup=()=>drag=null;canvas.onpointercancel=()=>drag=null;canvas.onpointermove=e=>{if(!drag||view!=='3d')return;yaw+=(e.clientX-drag[0])*.009;pitch=Math.max(.1,Math.min(1.5,pitch+(e.clientY-drag[1])*.007));drag=[e.clientX,e.clientY];draw();};canvas.onwheel=e=>{e.preventDefault();zoom=Math.max(.3,Math.min(4,zoom*Math.exp(-e.deltaY*.001)));draw();};
function boxEdges(box){const [a,b,c,d,e,f]=box;const v=[[a,b,c],[d,b,c],[d,e,c],[a,e,c],[a,b,f],[d,b,f],[d,e,f],[a,e,f]];return [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]].map(([i,j])=>[v[i],v[j]]);}
function current(){if(!plan?.moves.length)return null;let lo=0,hi=durations.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(durations[mid].end<elapsed)lo=mid+1;else hi=mid;}const move=plan.moves[lo],d=durations[lo],u=Math.max(0,Math.min(1,(elapsed-d.start)/(d.end-d.start||1)));return {index:lo,move,point:move.a.map((v,i)=>v+(move.b[i]-v)*u)};}
function draw(){const rect=canvas.getBoundingClientRect();if(!rect.width)return;const dpr=devicePixelRatio||1;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=rect.height;ctx.clearRect(0,0,w,h);
 const visibleModel=isGcodeMode()?null:model;
 const size=simulation?[simulation.x,simulation.y,simulation.z]:visibleModel?visibleModel.size:[100,70,20];
 const scale=Math.min(w/(size[0]*1.6+50),h/(Math.max(size[1],size[2])*1.8+70))*zoom;
 const center=[size[0]/2,size[1]/2,simulation?simulation.top_z-simulation.z/3:-size[2]/3];
 function project(p){let x=p[0]-center[0],y=p[1]-center[1],z=p[2]-center[2];if(view==='xy')return [w/2+x*scale,h/2-y*scale,z];if(view==='xz')return [w/2+x*scale,h/2-z*scale,y];if(view==='yz')return [w/2+y*scale,h/2-z*scale,x];const u=x*Math.cos(yaw)-y*Math.sin(yaw),v=x*Math.sin(yaw)+y*Math.cos(yaw);return [w/2+u*scale,h/2+v*Math.sin(pitch)*scale-z*Math.cos(pitch)*scale,v*Math.cos(pitch)+z*Math.sin(pitch)];}
 function line(a,b,color,width=1,dash=[]){const aa=project(a),bb=project(b);ctx.beginPath();ctx.moveTo(aa[0],aa[1]);ctx.lineTo(bb[0],bb[1]);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([]);}
 const gridZ=simulation?simulation.bottom_z:-size[2];for(let i=-10;i<=14;i++){line([i*10,-60,gridZ],[i*10,140,gridZ],'#dce6e5',.6);line([-100,i*10,gridZ],[160,i*10,gridZ],'#dce6e5',.6);}
 if(simulation&&$('show_stock').checked){renderStock(ctx,simulation,total>0?elapsed/total:0,view,project);}
 if(visibleModel&&(!simulation||$('show_reference').checked)){const vertices=visibleModel.vertices.map(project);let faces=visibleModel.triangles.map(t=>({t,depth:t.reduce((s,i)=>s+vertices[i][2],0)/3})).sort((a,b)=>a.depth-b.depth);for(const {t}of faces){const a=visibleModel.vertices[t[0]],b=visibleModel.vertices[t[1]],c=visibleModel.vertices[t[2]],u=b.map((v,i)=>v-a[i]),v=c.map((val,i)=>val-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],norm=Math.hypot(...n)||1,shade=.60+.26*Math.abs(n[2]/norm)+.1*Math.abs(n[0]/norm);ctx.fillStyle=`rgba(${Math.round(139*shade)},${Math.round(173*shade)},${Math.round(172*shade)},${simulation ? .48 : 1})`;ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=.4;ctx.beginPath();t.forEach((index,j)=>{const p=vertices[index];j?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);});ctx.closePath();ctx.fill();ctx.stroke();}
 if(!simulation&&$('show_stock').checked){let c;try{c=readSettings();}catch{c={stock_x:size[0],stock_y:size[1],stock_z:size[2]+1,fixture_boxes:[]};}boxEdges([0,0,-size[2],c.stock_x,c.stock_y,c.stock_z-size[2]]).forEach(([a,b])=>line(a,b,'#8ca8a588',1,[4,4]));for(const box of c.fixture_boxes||[])if(Array.isArray(box)&&box.length===6)boxEdges(box).forEach(([a,b])=>line(a,b,'#c68d65',1.5));}
 }
 const cursor=current();if(plan&&$('show_path').checked){for(let i=0;i<plan.moves.length;i++){const m=plan.moves[i],done=cursor&&i<=cursor.index;line(m.a,m.b,m.mode==='G0'?(done?'#c9a15e88':'#c9a15e24'):(done?'#10a6a0c9':'#109b9c26'),done?1.4:.7,m.mode==='G0'?[3,3]:[]);}if(cursor){const t=catalog.tools.find(t=>t.id===cursor.move.tool),point=cursor.point;
 function cylinder(radius,z0,z1,color){const lower=[],upper=[];for(let i=0;i<20;i++){const angle=i*Math.PI/10;lower.push(project([point[0]+Math.cos(angle)*radius,point[1]+Math.sin(angle)*radius,point[2]+z0]));upper.push(project([point[0]+Math.cos(angle)*radius,point[1]+Math.sin(angle)*radius,point[2]+z1]));}ctx.fillStyle=color;for(let i=0;i<20;i++){const j=(i+1)%20;ctx.beginPath();ctx.moveTo(...lower[i].slice(0,2));ctx.lineTo(...lower[j].slice(0,2));ctx.lineTo(...upper[j].slice(0,2));ctx.lineTo(...upper[i].slice(0,2));ctx.closePath();ctx.fill();}ctx.beginPath();upper.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fill();}
 // Show real catalog dimensions, even if holder is above the viewport.
 cylinder(t.diameter/2,0,t.length,'#177c7a7a');cylinder(t.holder_diameter/2,t.length,t.length+t.holder_length,'#35565a70');const pp=project(point);ctx.fillStyle='#fff';ctx.strokeStyle='#008e86';ctx.lineWidth=2;ctx.beginPath();ctx.arc(pp[0],pp[1],4,0,Math.PI*2);ctx.fill();ctx.stroke();$('coordinates').textContent=point.map((v,i)=>'XYZ'[i]+' '+v.toFixed(3)).join('     ')+'     T'+t.number+' / G54 mm';}}
 line([0,0,gridZ],[15,0,gridZ],'#b86b5a',2);line([0,0,gridZ],[0,15,gridZ],'#55a186',2);line([0,0,gridZ],[0,0,gridZ+15],'#6095bb',2);ctx.font='10px monospace';for(const [label,p,color]of [['X',[18,0,gridZ],'#b86b5a'],['Y',[0,18,gridZ],'#55a186'],['Z',[0,0,gridZ+18],'#6095bb']]){const q=project(p);ctx.fillStyle=color;ctx.fillText(label,q[0],q[1]);}
 $('progress').textContent=(total?Math.round(elapsed/total*100):0)+'%';$('timeline').value=total?elapsed/total*1000:0;
 if(simulation){const sample=simulationFrame(simulation,total>0?elapsed/total:0);
  $('material-summary').textContent=`素材 ${simulation.material} · 加工進度 ${Math.round(sample.progress*100)}% · 已除料 ${Math.round(sample.removed_mm3).toLocaleString()} / ${Math.round(simulation.removed_mm3).toLocaleString()} mm³ · 完工剩餘 ${Math.round(simulation.remaining_mm3).toLocaleString()} mm³（${simulation.remaining_pct.toFixed(1)}%） · 估計除料質量 ${simulation.removed_mass_g.toFixed(1)} g`;
 }
}
function animate(now){if(playing&&plan){elapsed=Math.min(total,elapsed+(now-last)/1000*Number($('speed').value));if(elapsed>=total){playing=false;$('play').textContent='▶';}draw();}last=now;requestAnimationFrame(animate);}requestAnimationFrame(animate);new ResizeObserver(draw).observe(canvas.parentElement);
api('/api/status').then(data=>{
 catalog=data.catalog;labelOptions('machine',catalog.machines);labelOptions('gcode-machine',catalog.machines);labelOptions('material',catalog.materials);labelOptions('fixture',catalog.fixtures);labelOptions('surface-rough-tool',catalog.tools.filter(t=>t.kind==='endmill'));$('surface-rough-tool').value='em6';
 labelOptions('gcode-material',catalog.materials);labelOptions('gcode-tool',catalog.tools);$('gcode-tool').value='em6';$('gcode-material').value='al6061';
 machineFields();updateMode();$('service').textContent='瀏覽器版 '+data.version+' · WASM 按需載入';$('use_lite').checked=false;draw();
}).catch(e=>{$('service').textContent='瀏覽器資源載入失敗';toast(e.message);});

$('cancel').onclick=()=>{stopEngine();stopLite();};
window.addEventListener('beforeunload',()=>{stopEngine();stopLite();if(ncURL)URL.revokeObjectURL(ncURL);});
