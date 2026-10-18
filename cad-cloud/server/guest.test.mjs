import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createBroker,validateRequest} from './guest.mjs';
const defaults=JSON.parse(await readFile(new URL('../engine/config.json',import.meta.url),'utf8'));
function harness(){
  let quota=null,sha=0,dispatches=0,active=0,dispatchError=false;
  const response=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
  const fetchImpl=async(url,options)=>{
    const p=new URL(url).pathname,method=options.method;
    if(p.endsWith('/git/ref/heads/cad-control'))return response({object:{sha:'main'}});
    if(p.endsWith('/rate-limit.json')&&method==='GET')return quota?response({sha:String(sha),content:Buffer.from(JSON.stringify(quota)).toString('base64')}):response({},404);
    if(p.endsWith('/rate-limit.json')&&method==='PUT'){
      const body=JSON.parse(options.body);
      if((quota&&body.sha!==String(sha))||(!quota&&body.sha))return response({},409);
      quota=JSON.parse(Buffer.from(body.content,'base64').toString());sha++;return response({content:{sha:String(sha)}});
    }
    if(p.endsWith('/runs'))return response({total_count:active,workflow_runs:[]});
    if(p.endsWith('/dispatches')){dispatches++;return response({},dispatchError?403:204);}
    throw Error('Unexpected GitHub operation '+method+' '+p);
  };
  const broker=createBroker({token:'server-test-only',fetchImpl,now:()=>1792318000000});
  return {broker,get quota(){return quota;},get dispatches(){return dispatches;},set active(x){active=x;},set dispatchError(x){dispatchError=x;}};
}
const request=()=>({job_id:randomUUID(),requirements:{...defaults}});
test('fixed server repository and administrator credential required',()=>{
  assert.throws(()=>createBroker({}),/尚未設定/);
  assert.throws(()=>createBroker({token:'x',repo:'other/repo'}),/不符/);
});
test('untrusted program path is disabled and invalid dimensions rejected',()=>{
  const c=request();c.requirements.dwg_converter='arbitrary.exe';c.requirements.require_dwg=true;
  assert.equal(validateRequest(c).requirements.dwg_converter,'');
  c.requirements.cam_root_mm=60;assert.throws(()=>validateRequest(c));
});
test('submit is durable, bounded and idempotent',async()=>{
  const h=harness(),r=request();await h.broker.submit(r,'192.0.2.1');
  assert.equal(h.dispatches,1);assert.equal(h.quota.count,1);assert.equal(h.quota.requests[0].state,'submitted');
  assert(!JSON.stringify(h.quota).includes('192.0.2.1'));
  const replay=await h.broker.submit(r,'192.0.2.1');assert.equal(replay.replayed,true);assert.equal(h.dispatches,1);
  await assert.rejects(h.broker.submit(request(),'192.0.2.2'),e=>e.status===429);
});
test('concurrent requests reserve only one slot through compare and swap',async()=>{
  const h=harness();const results=await Promise.allSettled([h.broker.submit(request(),'a'),h.broker.submit(request(),'b')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(h.dispatches,1);assert.equal(h.quota.count,1);
});
test('running cloud task prevents anonymous dispatch',async()=>{
  const h=harness();h.active=1;await assert.rejects(h.broker.submit(request(),'a'),e=>e.status===429);assert.equal(h.dispatches,0);
});
test('failed dispatch consumes reservation and is not replayed as a success',async()=>{
  const h=harness();h.dispatchError=true;const r=request();await assert.rejects(h.broker.submit(r,'a'),e=>e.status===502);
  assert.equal(h.quota.count,1);assert.equal(h.quota.requests[0].state,'dispatch_failed');
  await assert.rejects(h.broker.submit(r,'a'),e=>e.status===503);assert.equal(h.dispatches,1);
});
