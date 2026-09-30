import { randomBytes, createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { replay, MAX_ACTIONS, SESSION_TTL } from '../lib/score-rules.mjs';
import { redisStore } from '../lib/score-store.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export function createHandler({store, now=Date.now, env=process.env, snapshot}={}) {
  const fallback=snapshot || (()=>readFile(new URL('../xiaoyuge/scores.json',import.meta.url),'utf8').then(JSON.parse));
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Origin');
    res.setHeader('X-Content-Type-Options','nosniff');
    const origin=req.headers.origin;
    const allowed=origin==='https://maxjimtech.github.io' || (env.SCORE_ALLOW_LOCALHOST==='true' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin||''));
    if(origin && !allowed) return res.status(403).json({ok:false,error:'不允許的來源'});
    if(allowed)res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');
    if(req.method==='OPTIONS')return allowed?res.status(204).end():res.status(403).json({ok:false,error:'不允許的來源'});
    if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET,POST,OPTIONS');return res.status(405).json({ok:false,error:'Method not allowed'});}
    if(req.method==='POST' && !allowed)return res.status(403).json({ok:false,error:'不允許的來源'});
    try {
      const db=store===undefined?redisStore(env):store;
      if(req.method==='GET')return res.status(200).json({ok:true,...(await db?.board() || await fallback())});
      // No in-memory or Git-commit fallback: missing durable protection means no writes.
      if(!db)return res.status(503).json({ok:false,error:'線上送分尚未啟用；請保留本機紀錄'});
      const address=env.VERCEL==='1'?req.headers['x-vercel-forwarded-for']:req.socket?.remoteAddress;
      if(typeof address!=='string' || !isIP(address))return res.status(503).json({ok:false,error:'無法驗證連線'});
      // Salt IP identifiers using the existing Redis credential; never persist raw addresses.
      const ip=createHmac('sha256',env.UPSTASH_REDIS_REST_TOKEN || 'local-test-only').update(address).digest('hex');
      const time=now();
      if(!await db.rate(ip,time)){res.setHeader('Retry-After',String(60-Math.floor(time/1000)%60));return res.status(429).json({ok:false,error:'送分過於頻繁，請稍後再試'});}
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return res.status(415).json({ok:false,error:'需要 JSON'});
      let body;try {if(Number(req.headers['content-length'])>65536)throw Error();const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);if(!raw || Buffer.byteLength(raw)>65536)throw Error();body=JSON.parse(raw);}catch{return res.status(400).json({ok:false,error:'資料格式不正確'});}
      if(!body || Array.isArray(body) || typeof body!=='object')return res.status(400).json({ok:false,error:'資料格式不正確'});
      if(body.action==='session'){
        const token=randomBytes(32).toString('base64url'),seed=randomBytes(4).readUInt32LE();
        if(!await db.create(hash(token),{seed,issued:time,origin,ip},SESSION_TTL))throw Error();
        return res.status(200).json({ok:true,token,seed,expiresIn:SESSION_TTL});
      }
      const {name,score,token,actions}=body;
      if(typeof name!=='string' || !name.trim() || name.length>12 || /[<>\u0000-\u001f\u007f]/.test(name) || !Number.isSafeInteger(score) || score<0 || !Array.isArray(actions) || actions.length>MAX_ACTIONS)
        return res.status(400).json({ok:false,error:'姓名或分數格式不正確'});
      if(typeof token!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(token))return res.status(401).json({ok:false,error:'缺少有效遊戲工作階段'});
      const id=hash(token),session=await db.session(id);
      if(!session || session.origin!==origin || session.ip!==ip || time<session.issued || time-session.issued>=SESSION_TTL*1000)return res.status(409).json({ok:false,error:'工作階段已過期或已使用'});
      // Online eligibility budget, not a gameplay limit: 20 initial actions + 20/sec.
      if(actions.length>20+Math.floor((time-session.issued)/1000)*20)return res.status(400).json({ok:false,error:'操作紀錄不合理'});
      const aerations=actions.filter(a=>a==='a').length;
      if(score>1390+6*aerations)return res.status(400).json({ok:false,error:'分數超出操作可達範圍'});
      let computed;try{computed=replay(session.seed,actions);}catch{return res.status(400).json({ok:false,error:'遊戲紀錄不完整或不合理'});}
      if(score!==computed)return res.status(400).json({ok:false,error:'分數與遊戲紀錄不符'});
      const result=await db.submit(id,session,{name:name.trim(),score:computed,date:new Date(time).toISOString().slice(0,10)},await fallback());
      if(!result)return res.status(409).json({ok:false,error:'工作階段已使用'});
      return res.status(200).json({ok:true,newHigh:result.newHigh,...result.board});
    }catch {return res.status(503).json({ok:false,error:'排行榜暫時無法更新'});}
  };
}
export default createHandler();
