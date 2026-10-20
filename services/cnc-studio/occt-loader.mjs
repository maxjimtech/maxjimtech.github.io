import initOpenCascade from './vendor/occt.mjs';
let promise;
export function loadKernel(progress=()=>{}){
 if(promise)return promise;
 promise=(async()=>{
  const base=new URL('./vendor/',import.meta.url),response=await fetch(new URL('occt-manifest.json',base));
  if(!response.ok)throw Error('WASM 版本清單讀取失敗');const manifest=await response.json();
  const pieces=[];let complete=0;
  // Fetch fixed, same-origin assets. No user STEP bytes leave the browser.
  for(let start=0;start<manifest.parts.length;start+=3){
   const batch=await Promise.all(manifest.parts.slice(start,start+3).map(async name=>{if(!/^occt\.wasm\.gz\.\d{3}$/.test(name))throw Error('無效 WASM 分段名稱');const r=await fetch(new URL(name,base));if(!r.ok)throw Error('WASM 分段載入失敗：'+name);const bytes=new Uint8Array(await r.arrayBuffer());progress(`幾何核心載入 ${++complete}/${manifest.parts.length}`);return bytes;}));pieces.push(...batch);
  }
  if(pieces.reduce((n,p)=>n+p.length,0)!==manifest.compressed_bytes)throw Error('WASM 壓縮長度不符');
  if(!globalThis.DecompressionStream)throw Error('瀏覽器不支援 gzip 解壓縮，請更新 Chrome／Edge／Firefox');
  const stream=new Blob(pieces).stream().pipeThrough(new DecompressionStream('gzip'));
  const binary=new Uint8Array(await new Response(stream).arrayBuffer());
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',binary))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(binary.length!==manifest.bytes||hash!==manifest.sha256)throw Error('WASM SHA256 核對失敗，停止幾何運算');
  progress('WASM 完整性已確認，正在初始化 OpenCascade');
  return initOpenCascade({wasmBinary:binary,print:()=>{},printErr:()=>{}});
 })();promise.catch(()=>promise=undefined);return promise;
}
