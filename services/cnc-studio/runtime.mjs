let worker;
const pending=new Map();
function engine(){
 if(worker)return worker;
 worker=new Worker(new URL('./engine-worker.mjs',import.meta.url),{type:'module'});
 worker.onmessage=event=>{const {id,result,error,progress}=event.data,item=pending.get(id);if(!item)return;if(progress){const button=document.getElementById('plan');if(button)button.textContent=progress;return;}clearTimeout(item.timeout);pending.delete(id);error?item.reject(Error(error)):item.resolve(result);};
 worker.onerror=event=>stopEngine(event.message||'瀏覽器幾何核心發生錯誤');return worker;
}
export function stopEngine(message='已取消運算'){
 worker?.terminate();worker=undefined;for(const item of pending.values()){clearTimeout(item.timeout);item.reject(Error(message));}pending.clear();
}
export function callEngine(operation,payload){
 return new Promise((resolve,reject)=>{const w=engine(),id=crypto.randomUUID(),timeout=setTimeout(()=>stopEngine('運算逾時，請簡化 STEP 或重新嘗試'),180000);pending.set(id,{resolve,reject,timeout});w.postMessage({id,operation,payload});});
}
export async function browserAPI(path,body,headers){
 if(path==='/api/status'){
  const response=await fetch(new URL('./catalog.json',import.meta.url));if(!response.ok)throw Error('刀具目錄讀取失敗');
  return {version:'0.7.0',shared_version:'0.2.0',catalog:await response.json(),laya_enabled:false,laya:{loaded:false,status:'REPLACED_BY_OPTIONAL_MINILM'}};
 }
 if(path==='/api/upload')return callEngine('analyze',{bytes:await body.arrayBuffer(),name:decodeURIComponent(headers['X-Filename'])});
 if(path==='/api/demo'){
  const res=await fetch(new URL('./examples/demo.step',import.meta.url));if(!res.ok)throw Error('範例 STEP 載入失敗');
  return callEngine('analyze',{bytes:await res.arrayBuffer(),name:'Demo_plate_100x70.step'});
 }
 if(path==='/api/surface-demo'){
  const res=await fetch(new URL('./examples/surface_trough.step',import.meta.url));if(!res.ok)throw Error('曲面 STEP 範例載入失敗');
  return callEngine('analyze',{bytes:await res.arrayBuffer(),name:'Surface_trough_80x60.step'});
 }
 if(path==='/api/plan')throw Error('請透過本版模型計畫函式計算');
 throw Error('此瀏覽器版未啟用該後端功能');
}
