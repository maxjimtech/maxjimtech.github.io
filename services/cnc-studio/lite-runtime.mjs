let worker;
const pending=new Map();

function getWorker(){
 if(worker)return worker;
 worker=new Worker(new URL('./lite-worker.mjs',import.meta.url),{type:'module'});
 worker.onmessage=event=>{
  const {id,result,error,progress}=event.data,item=pending.get(id);
  if(!item)return;
  if(progress){item.onProgress?.(progress);return;}
  clearTimeout(item.timeout);pending.delete(id);
  error?item.reject(Error(error)):item.resolve(result);
 };
 worker.onerror=event=>stopLite(event.message||'MiniLM Worker 發生錯誤');
 return worker;
}

export function stopLite(message='已取消 MiniLM 推論'){
 worker?.terminate();worker=undefined;
 for(const p of pending.values()){clearTimeout(p.timeout);p.reject(Error(message));}
 pending.clear();
}

export function runLite(payload,onProgress){
 return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID(),timeout=setTimeout(()=>stopLite('MiniLM 下載或推論逾時，請檢查網路並改用規則規劃'),300000);
  pending.set(id,{resolve,reject,onProgress,timeout});
  getWorker().postMessage({id,payload});
 });
}
