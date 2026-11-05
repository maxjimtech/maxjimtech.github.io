import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createHandler } from '../api/score.js';
import { replay, SESSION_TTL, MAX_ACTIONS } from '../lib/score-rules.mjs';
import { redisStore, RATE_SCRIPT, SUBMIT_SCRIPT } from '../lib/score-store.mjs';
const empty=()=>({highScore:{name:'尚未有人上榜',score:0,date:''},top10:[]});
// Test double shares persistent state between independently created handlers.
class Store {
  sessions=new Map();rates=new Map();boardValue=null;
  async rate(ip,now){const key=ip+Math.floor(now/60000);const n=(this.rates.get(key)||0)+1;this.rates.set(key,n);return n<=12;}
  async create(id,s){this.sessions.set(id,s);return true;}
  async session(id){return this.sessions.get(id)||null;}
  async board(){return this.boardValue;}
  async submit(id,s,entry,fallback){if(!this.sessions.has(id))return null;this.sessions.delete(id);const b=this.boardValue||fallback;const newHigh=entry.score>b.highScore.score;if(newHigh)b.highScore=entry;b.top10.push(entry);b.top10.sort((a,b)=>b.score-a.score);b.top10=b.top10.slice(0,10);this.boardValue=b;return {board:b,newHigh};}
}
const origin='https://maxjimtech.github.io';
function fixture(){let time=1800000000000;const store=new Store();const options={store,now:()=>time,env:{},snapshot:async()=>empty()};return {store,options,handler:createHandler(options),advance:n=>time+=n};}
async function request(handler,body,{method='POST',headers={},ip='192.0.2.1'}={}){
 const res={code:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},end(){return this;}};
 await handler({method,headers:{origin,'content-type':'application/json',...headers},socket:{remoteAddress:ip},body},res);return res;
}
const actions=Array.from({length:20},()=>['a','a','a','f','f','w','n']).flat();
async function valid(f){const r=await request(f.handler,{action:'session'});assert.equal(r.code,200);f.advance(20000);return {name:'測試玩家',score:replay(r.body.seed,actions),token:r.body.token,actions};}

test('normal legal submission recomputes score and never requests GitHub',async()=>{const f=fixture();const body=await valid(f);const r=await request(f.handler,body);assert.equal(r.code,200);assert.equal(r.body.highScore.score,body.score);});
test('forged high score and coerced score rejected without consuming nonce',async()=>{const f=fixture();const body=await valid(f);for(const score of [100000,Number.MAX_SAFE_INTEGER,'650',null,-1,1.5])assert.equal((await request(f.handler,{...body,score})).code,400);assert.equal((await request(f.handler,body)).code,200);});
test('wrong and missing Origin and deceptive localhost rejected before store access',async()=>{for(const value of ['https://attacker.example',undefined,'http://localhost:3000.attacker.example']){const f=fixture();const r=await request(f.handler,{action:'session'},{headers:{origin:value}});assert.equal(r.code,403);assert.equal(f.store.sessions.size,0);}});
test('sequential and simultaneous replays rejected across handlers',async()=>{const f=fixture();const body=await valid(f);const other=createHandler(f.options);const results=await Promise.all([request(f.handler,body),request(other,body)]);assert.deepEqual(results.map(r=>r.code).sort(),[200,409]);assert.equal((await request(other,body)).code,409);assert.equal(f.store.boardValue.top10.length,1);});
test('persistent rate budget spans cold starts and invalid POSTs',async()=>{const f=fixture();const results=await Promise.all(Array.from({length:30},()=>request(createHandler(f.options),{})));assert.equal(results.filter(r=>r.code===429).length,18);assert.equal(f.store.sessions.size,0);});
test('session endpoint itself rate limited; expires and is bound to IP',async()=>{const f=fixture();const body=await valid(f);assert.equal((await request(f.handler,body,{ip:'192.0.2.2'})).code,409);f.advance(SESSION_TTL*1000);assert.equal((await request(f.handler,body)).code,409);const g=fixture();for(let i=0;i<12;i++)assert.equal((await request(g.handler,{action:'session'})).code,200);assert.equal((await request(g.handler,{action:'session'})).code,429);});
test('unconfigured or failed durable store fails closed, snapshot remains readable',async()=>{const h=createHandler({store:null,snapshot:async()=>empty()});assert.equal((await request(h,{action:'session'})).code,503);assert.equal((await request(h,null,{method:'GET',headers:{origin:undefined}})).code,200);const f=fixture();f.store.rate=async()=>{throw Error('sensitive upstream error');};const r=await request(f.handler,{});assert.equal(r.code,503);assert.ok(!JSON.stringify(r.body).includes('sensitive'));});
test('malformed JSON, oversized payload, invalid transcript and impossible pace',async()=>{const f=fixture();assert.equal((await request(f.handler,'{')).code,400);assert.equal((await request(f.handler,' '.repeat(65537))).code,400);const r=await request(f.handler,{action:'session'});assert.equal((await request(f.handler,{name:'測試',score:100,token:r.body.token,actions})).code,400);f.advance(20000);for(const log of [[],['n','bad'],['f','f','f'],['w','w'],Array(MAX_ACTIONS+1).fill('a')])assert.equal((await request(f.handler,{name:'測試',score:100,token:r.body.token,actions:log})).code,400);});
test('Vercel proxy IP cannot be selected by the browser; no unknown-IP fallback',async()=>{const f=fixture();const h=createHandler({...f.options,env:{VERCEL:'1'}});assert.equal((await request(h,{action:'session'})).code,503);assert.equal((await request(h,{action:'session'},{headers:{'x-vercel-forwarded-for':'192.0.2.1'}})).code,200);});
test('REST adapter commands carry atomic Lua, TTL, NX and isolated deployment keys',async()=>{
 const commands=[];const env={UPSTASH_REDIS_REST_URL:'https://redis.invalid',UPSTASH_REDIS_REST_TOKEN:'test-placeholder',VERCEL_ENV:'production'};
 const store=redisStore(env,async(_url,opts)=>{const args=JSON.parse(opts.body);commands.push(args);return {ok:true,json:async()=>({result:args[1]===RATE_SCRIPT?[1,1]:args[0]==='SET'?'OK':args[1]===SUBMIT_SCRIPT?[JSON.stringify(empty()),0]:null})};});
 assert.equal(await store.rate('hashed-ip',0),true);await store.create('id',{seed:1},900);await store.submit('id',{seed:1},{name:'A',score:1},empty());
 assert.equal(commands[0][0],'EVAL');assert.ok(commands[0][3].startsWith('xiaoyuge:v2:production:'));
 assert.deepEqual(commands[1].slice(-3),['EX',900,'NX']);assert.equal(commands[2][1],SUBMIT_SCRIPT);
 assert.equal(redisStore({}),null);
});

test('actual frontend and server rules agree for 30 seeded games, with unchanged FX randomness',async()=>{
 const source=await readFile(new URL('../xiaoyuge/game-v6.js',import.meta.url),'utf8');
 for(let seed=1;seed<=30;seed++){
  const nodes=new Map();const E=id=>{if(!nodes.has(id))nodes.set(id,{style:{setProperty(){}},textContent:'',value:'測試',focus(){},appendChild(){},querySelectorAll(){return [];}});return nodes.get(id);};
  let sent;
  const context={document:{getElementById:E,addEventListener(){},documentElement:E('root'),querySelectorAll(){return [];},createElement:()=>E('dummy')},window:{XIAOYUGE_SCORE_API:'https://api.invalid',innerHeight:800,addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}},setTimeout(){},location:{reload(){}},AbortSignal,console,fetch:async(_url,opts)=>{const b=opts?.body&&JSON.parse(opts.body);if(b?.action==='session')return {ok:true,json:async()=>({ok:true,token:'test-placeholder',seed})};if(b){sent=b;return {ok:true,json:async()=>({ok:true,newHigh:true,...empty()})};}return {ok:true,json:async()=>empty()};}};
  vm.runInNewContext(source,context);await E('start').onclick();
  const log=[];
  for(let d=0;d<20;d++){for(const a of ['a','a','a','f','f','w','n']){E({a:'aerate',f:'feed',w:'water',n:'next'}[a]).onclick();log.push(a);}}
  assert.equal(typeof E('saveWinner').onclick,'function');await E('saveWinner').onclick();
  assert.ok(sent,'frontend must obtain session before submitting');assert.equal(sent.score,replay(seed,log));assert.deepEqual(sent.actions,log);
 }
});
