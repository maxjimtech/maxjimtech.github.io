import {recommendLite,LITE_MODEL} from './decision-lite.mjs';

let extractor;
async function embeddings(texts,id){
 if(!extractor){
  self.postMessage({id,progress:'下載 MiniLM 8-bit 模型（約 23 MB）及推論核心…'});
  // Lazy browser-only model load: no STEP bytes or feature data are uploaded.
  const {pipeline,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1');
  env.allowLocalModels=false;
  extractor=await pipeline('feature-extraction',LITE_MODEL,{device:'wasm',dtype:'q8',progress_callback:p=>{
   if(p.status==='progress'&&p.progress!==undefined)self.postMessage({id,progress:`下載 MiniLM：${Math.round(p.progress)}%`});
  }});
 }
 const out=await extractor(texts,{pooling:'mean',normalize:true});
 return out.tolist();
}

self.onmessage=async event=>{
 const {id,payload}=event.data;
 try{
  const result=await recommendLite(payload,texts=>embeddings(texts,id));
  self.postMessage({id,result});
 }catch(error){self.postMessage({id,error:String(error?.message||error)});}
};
