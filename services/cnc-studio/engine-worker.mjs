import {loadKernel} from './occt-loader.mjs';
import {analyzeSTEP} from './kernel.mjs';
import {buildPlan,defaultSettings,chooseMachine,gcode,validate} from './cam.mjs';
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
  }else if(operation==='plan'){
   const cat=await catalog(),settings=structuredClone(payload.settings);
   validate(payload.model,settings,cat);
   let recommendation;
   if(payload.auto_machine){recommendation=chooseMachine(payload.model,settings,cat);settings.machine=recommendation.machine;settings.machine_limits={};}
   const plan=buildPlan(payload.model,settings,cat,payload.strategy||'raster');
   plan.id=crypto.randomUUID().replaceAll('-','');plan.model_id=payload.model.id;plan.source_sha256=payload.model.audit.sha256;
   plan.recommendation=recommendation||{method:'manual-machine-selection'};
   plan.ai={status:'RULES_ENGINE',executed:false,review_required:false,message:'此版未載入 Laya。母機與製程由數值規則／幾何辨識產生。'};
   if(!plan.blockers.length)plan.nc=gcode(plan,cat);
   self.postMessage({id,result:plan});
  }else throw Error('不支援的作業');
 }catch(error){self.postMessage({id,error:String(error?.message||error)});}
};
