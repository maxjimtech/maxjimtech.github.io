import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from './handler.mjs';
function response(){return {headers:{},code:200,setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(data){this.data=data;return this;},end(){this.ended=true;return this;}};}
async function invoke(req,token){
  const original=process.env.CAD_GITHUB_TOKEN;
  if(token)process.env.CAD_GITHUB_TOKEN=token;else delete process.env.CAD_GITHUB_TOKEN;
  const res=response();try{await handler({query:{},headers:{},...req},res);return res;}
  finally{if(original===undefined)delete process.env.CAD_GITHUB_TOKEN;else process.env.CAD_GITHUB_TOKEN=original;}
}
test('health reports four global attempts, Taipei timezone and contact without exposing a credential',async()=>{
  const res=await invoke({method:'GET'});
  assert.equal(res.code,200);assert.equal(res.data.configured,false);
  assert.equal(res.data.daily_limit,4);assert.equal(res.data.quota_scope,'global');
  assert.equal(res.data.timezone,'Asia/Taipei');assert.equal(res.data.contact,'0931675001');
  const ready=await invoke({method:'GET'},'server-test-secret');
  assert.equal(ready.data.configured,true);assert(!JSON.stringify(ready).includes('server-test-secret'));
});
test('CORS accepts only the public CAD site and never enables credentialed browser requests',async()=>{
  const allowed=await invoke({method:'OPTIONS',headers:{origin:'https://maxjimtech.github.io'}});
  assert.equal(allowed.code,204);assert(allowed.ended);
  assert.equal(allowed.headers['Access-Control-Allow-Origin'],'https://maxjimtech.github.io');
  assert.equal(allowed.headers['Access-Control-Allow-Credentials'],undefined);
  const denied=await invoke({method:'OPTIONS',headers:{origin:'https://other.invalid'}});
  assert.equal(denied.code,403);assert.equal(denied.headers['Access-Control-Allow-Origin'],undefined);
});
test('invalid anonymous requests fail before any GitHub request',async()=>{
  const headers={origin:'https://maxjimtech.github.io','content-type':'application/json'};
  for(const [req,status] of [
    [{method:'POST',headers:{...headers,origin:'https://other.invalid'},body:{}},403],
    [{method:'POST',headers:{...headers,'content-type':'text/plain'},body:{}},415],
    [{method:'POST',headers,body:{padding:'x'.repeat(16001)}},413],
    [{method:'POST',headers,body:{job_id:'invalid',requirements:{}}},400],
    [{method:'DELETE',headers},405]
  ]){
    const res=await invoke(req,'server-test-secret');assert.equal(res.code,status);
  }
});
