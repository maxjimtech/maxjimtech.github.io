// Configuration contains only a public HTTPS endpoint, never a credential.
export function endpoint(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error('免登入後端網址設定錯誤');
  return u.href;
}
export async function guestRequest(url,{method='GET',body,job}={}){
  const u=new URL(endpoint(url));if(job)u.searchParams.set('job',job);
  const r=await fetch(u,{method,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)});
  const data=await r.json();
  if(!r.ok){const e=Error(data.message||'免登入雲端連線失敗');e.status=r.status;throw e;}
  return data;
}
