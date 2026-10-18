// Deploy on the cloud host; never place a GitHub credential in browser assets.
import {createBroker,HttpError} from './guest.mjs';
export default async function handler(req,res){
  const origin='https://maxjimtech.github.io';
  res.setHeader('Vary','Origin');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.headers.origin===origin)res.setHeader('Access-Control-Allow-Origin',origin);
  if(req.method==='OPTIONS'){
    if(req.headers.origin!==origin)return res.status(403).json({message:'來源不符'});
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');return res.status(204).end();
  }
  try{
    if(req.method==='GET'&&!req.query.job)return res.status(200).json({mode:'guest',configured:Boolean(process.env.CAD_GITHUB_TOKEN),daily_limit:Number(process.env.CAD_DAILY_LIMIT||6),cooldown_seconds:Number(process.env.CAD_COOLDOWN_SECONDS||300)});
    const broker=createBroker({token:process.env.CAD_GITHUB_TOKEN,dailyLimit:Number(process.env.CAD_DAILY_LIMIT||6),cooldownSeconds:Number(process.env.CAD_COOLDOWN_SECONDS||300)});
    if(req.method==='GET'){
      res.setHeader('Cache-Control','public, s-maxage=15, stale-while-revalidate=15');return res.status(200).json(await broker.status(String(req.query.job)));
    }
    if(req.method!=='POST'){res.setHeader('Allow','GET,POST,OPTIONS');return res.status(405).json({message:'不支援的請求'});}
    res.setHeader('Cache-Control','no-store');
    if(req.headers.origin!==origin)throw new HttpError(403,'來源不符');
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))throw new HttpError(415,'請使用 JSON 格式');
    if(Number(req.headers['content-length']||0)>16000||Buffer.byteLength(JSON.stringify(req.body||{}))>16000)throw new HttpError(413,'需求過長');
    const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
    return res.status(202).json(await broker.submit(req.body,ip));
  }catch(error){
    const status=error.github?502:(error instanceof HttpError?error.status:503);
    return res.status(status).json({message:error.github?'雲端授權暫時無法使用，請管理者確認設定':error instanceof HttpError?error.message:'免登入雲端服務暫時無法使用'});
  }
}
