import {loadKernel} from './occt-loader.mjs';
import {analyzeSTEP} from './kernel.mjs';
import {buildPlan,defaultSettings,chooseMachine,gcode,validate} from './cam.mjs';
import {buildSurfacePlan} from './surface.mjs';
import {parseGcode} from './gcode-import.mjs';
import {simulateStock} from './material-sim.mjs';
let catalogPromise;
const catalog=()=>catalogPromise||(catalogPromise=fetch(new URL('./catalog.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('刀具目錄載入失敗');return r.json();}));
self.onmessage=async event=>{
 const {id,operation,payload}=event.data;
 try{
  if(operation==='analyze'){
   const bytes=new Uint8Array(payload.bytes);
   if(!bytes.length||bytes.length>50*1024*1024)throw Error('STEP 檔案上限 50 MB');
   if(!new TextDecoder().decode(bytes.slice(0,4096)).toUpperCase().includes('ISO-10303-21'))throw Error('不是 STEP Part 21 檔案');
   const oc=await loadKernel(message=>self.postMessage({id,progress:message}));
   self.postMessage({id,progress:'精確 BREP 檢查、特徵辨識與重建比對中…'});
   const model=analyzeSTEP(oc,bytes,payload.name);
   model.id=crypto.randomUUID().replaceAll('-','');
   model.audit.sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
   self.postMessage({id,result:{model,settings:defaultSettings(model)}});
  }else if(operation==='gcodeImport'){
   const cat=await catalog();
   self.postMessage({id,progress:'正在解析 FANUC G-code 與刀具…'});
   const plan=parseGcode(payload.text,cat,{default_tool:payload.tool,initial_x:payload.stock.initial_x,initial_y:payload.stock.initial_y,initial_z:payload.stock.initial_z,machine:payload.machine||'vmc400'});
   const sim=simulateStock(plan.moves,cat,{...payload.stock,rapid_mm_min:plan.settings.resolved_machine.rapid},message=>self.postMessage({id,progress:message}));
   plan.settings.material=payload.stock.material;
   plan.minutes=Math.round(sim.minutes*100)/100;
   plan.cut_mm=Math.round(plan.moves.filter(m=>m.mode==='G1').reduce((v,m)=>v+Math.hypot(...m.a.map((x,i)=>m.b[i]-x)),0)*10)/10;
   plan.warnings.push(...sim.warnings);
   self.postMessage({id,result:{plan,simulation:sim}});
  }else if(operation==='stockSimulation'){
   const cat=await catalog();
   self.postMessage({id,progress:'正在計算除料後的加工表面…'});
   const simulation=simulateStock(payload.plan.moves,cat,{...payload.stock,rapid_mm_min:payload.plan.settings.resolved_machine.rapid},message=>self.postMessage({id,progress:message}));
   self.postMessage({id,result:{simulation}});
  }else if(operation==='plan'||operation==='surfacePlan'){
   const cat=await catalog(),settings=structuredClone(payload.settings);
   validate(payload.model,settings,cat);
   let recommendation;
   if(payload.auto_machine){recommendation=chooseMachine(payload.model,settings,cat);settings.machine=recommendation.machine;settings.machine_limits={};}
   const surface=operation==='surfacePlan';
   const plan=surface?buildSurfacePlan(payload.model,settings,cat,payload.surface||{}):buildPlan(payload.model,settings,cat,payload.strategy||'raster');
   plan.id=crypto.randomUUID().replaceAll('-','');plan.model_id=payload.model.id;plan.source_sha256=payload.model.audit.sha256;
   plan.recommendation=recommendation||{method:'manual-machine-selection'};
   plan.ai={status:'RULES_ENGINE',executed:false,review_required:false,message:surface?'三軸球刀曲面精修由高度場規則計算；本次不呼叫 MiniLM。':'母機與製程由數值規則／幾何辨識產生。'};
   if(!plan.blockers.length)plan.nc=gcode(plan,cat);
   self.postMessage({id,result:plan});
  }else throw Error('不支援的作業');
 }catch(error){self.postMessage({id,error:String(error?.message||error)});}
};
