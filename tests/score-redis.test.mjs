// Real Redis integration, never a production account. redis-cli must be installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { redisStore } from '../lib/score-store.mjs';
const execute=promisify(execFile);
const socket=process.env.REDIS_TEST_SOCKET,port=process.env.REDIS_TEST_PORT;
const cli=process.env.REDIS_TEST_CLI || 'redis-cli';
const connection=socket?['-s',socket]:['-h','127.0.0.1','-p',port||'6379'];
async function command(args){const {stdout}=await execute(cli,[...connection,'--json',...args.map(String)]);return JSON.parse(stdout);}
const env={UPSTASH_REDIS_REST_URL:'https://local-test.invalid',UPSTASH_REDIS_REST_TOKEN:'local-test-placeholder',VERCEL_ENV:'preview'};
const transport=async(_url,options)=>({ok:true,json:async()=>({result:await command(JSON.parse(options.body))})});
const empty=()=>({highScore:{name:'none',score:0,date:''},top10:[]});
const enabled=Boolean(socket||port);

test('real Redis rate limits survive adapter restarts, expire, and apply a global budget',{skip:!enabled},async()=>{
 const id=randomUUID(),now=Date.now()+Math.floor(Math.random()*1000000000);const store=redisStore(env,transport);
 for(let i=0;i<12;i++)assert.equal(await store.rate(id,now),true);
 assert.equal(await redisStore(env,transport).rate(id,now),false);
 const ttl=await command(['TTL',`xiaoyuge:v2:preview:rate:${Math.floor(now/60000)}:${id}`]);assert.ok(ttl>0&&ttl<=120);
 // Use a new artificial minute bucket to avoid other tests and live systems entirely.
 const globalNow=now+3600000;
 for(let i=0;i<120;i++)assert.equal(await store.rate(id+i,globalNow),true);
 assert.equal(await redisStore(env,transport).rate('global-overflow',globalNow),false);
});
test('real Redis Lua commits consume nonce atomically and preserve concurrent scores',{skip:!enabled},async()=>{
 const store=redisStore(env,transport),other=redisStore(env,transport),id=randomUUID();
 const session={seed:7,issued:Date.now(),ip:'hashed',origin:'https://maxjimtech.github.io'};
 assert.equal(await store.create(id,session,900),true);assert.equal(await other.create(id,session,900),false);
 assert.deepEqual(await other.session(id),session);
 assert.ok(await command(['TTL','xiaoyuge:v2:preview:session:'+id])>0);
 await command(['DEL','xiaoyuge:v2:preview:board']);
 const entry={name:'local-test',score:600,date:'2026-09-30'};
 const results=await Promise.all([store.submit(id,session,entry,empty()),other.submit(id,session,entry,empty())]);
 assert.equal(results.filter(Boolean).length,1);assert.equal(await other.session(id),null);
 assert.equal(await other.submit(id,session,entry,empty()),null);
 // Independent valid games racing update the same board; neither update is lost.
 const ids=[randomUUID(),randomUUID()];await Promise.all(ids.map(i=>store.create(i,session,900)));
 await Promise.all(ids.map((i,index)=>other.submit(i,session,{...entry,name:'race-'+index,score:700+index},empty())));
 const board=await store.board();assert.ok(board.top10.some(x=>x.name==='race-0'));assert.ok(board.top10.some(x=>x.name==='race-1'));
});
test('real Redis expiration and mismatched session do not change the board',{skip:!enabled},async()=>{
 const store=redisStore(env,transport),id=randomUUID(),s={seed:8};await store.create(id,s,900);
 const before=await store.board();assert.equal(await store.submit(id,{seed:9},{name:'invalid',score:999},empty()),null);
 await command(['PEXPIRE','xiaoyuge:v2:preview:session:'+id,1]);
 await new Promise(resolve=>setTimeout(resolve,15));
 assert.equal(await store.submit(id,s,{name:'expired',score:999},empty()),null);assert.deepEqual(await store.board(),before);
});
