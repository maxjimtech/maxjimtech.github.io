// Optional standalone cloud host entry; CAD remains on GitHub hosted runners.
import {createServer} from 'node:http';
import handler from '../../api/cad.mjs';
const port=Number(process.env.PORT||8080);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
createServer(async(req,res)=>{
  const url=new URL(req.url,'http://cloud.internal');
  if(url.pathname!=='/api/cad'){res.writeHead(404);res.end();return;}
  req.query=Object.fromEntries(url.searchParams);
  res.status=function(code){this.statusCode=code;return this;};
  res.json=function(data){this.setHeader('Content-Type','application/json; charset=utf-8');this.end(JSON.stringify(data));return this;};
  try{
    if(req.method==='POST'){
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>16000){res.status(413).json({message:'需求過長'});return;}chunks.push(chunk);}
      req.body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    await handler(req,res);
  }catch{if(!res.headersSent)res.status(400).json({message:'請求格式錯誤'});else res.end();}
}).listen(port,'0.0.0.0',()=>console.log('CAD guest broker listening on port '+port));
