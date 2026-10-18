// Runs only on a GitHub-hosted runner; no credential is supplied to this test.
import assert from 'node:assert/strict';
if(process.env.GITHUB_ACTIONS!=='true')throw Error('Run this check on GitHub Actions.');
const url=process.env.CAD_GUEST_API;
if(!url){console.log('Public guest check skipped outside production push.');process.exit(0);}
const origin='https://maxjimtech.github.io';
async function request(suffix='',options={}){
  return fetch(url+suffix,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
}
const health=await request('',{headers:{Origin:origin}});
assert.equal(health.status,200);
assert.equal(health.headers.get('access-control-allow-origin'),origin);
const config=await health.json();
assert.equal(config.mode,'guest');assert.equal(config.configured,true);
assert.equal(config.daily_limit,4);assert.equal(config.quota_scope,'global');
assert.equal(config.timezone,'Asia/Taipei');assert.equal(config.contact,'0931675001');
const options=await request('',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});
assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-origin'),origin);
const denied=await request('',{method:'OPTIONS',headers:{Origin:'https://example.com'}});
assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
// Reading a known historical failure verifies the server's GitHub Contents access.
const result=await request('?job=e34c1e40-e8dc-410b-bbf8-e93e3c6a479f');
assert.equal(result.status,200);assert.equal((await result.json()).status,'failed');
console.log('PUBLIC_GUEST_HEALTH_CORS_GITHUB_READ_PASS');
