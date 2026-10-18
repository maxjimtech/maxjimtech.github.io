// Cloud broker: no browser token, fixed repository, atomic persistent budget.
import {createHash,createHmac} from 'node:crypto';
export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const FIELDS=new Set(['project','motion','ratio','roller_count','axis_distance_mm','roller_pcd_mm','roller_od_mm','cam_od_mm','cam_root_mm','cam_width_mm','chamfer_mm','shaft_length_mm','plate_od_mm','plate_bore_mm','plate_thickness_mm','plate_back_to_cam_axis_mm','roller_bore_mm','roller_working_width_mm','roller_total_length_mm','clearance_mm','material','dwg_converter','require_dwg','check_interference']);
export function validateRequest(body){
  if(!body||!UUID.test(body.job_id)||!body.requirements||typeof body.requirements!=='object'||Array.isArray(body.requirements))throw new HttpError(400,'工作條件格式錯誤');
  const c={...body.requirements};
  for(const k of Object.keys(c))if(!FIELDS.has(k))throw new HttpError(400,'不支援的條件欄位');
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(c.project)||c.motion!=='constant_velocity')throw new HttpError(400,'專案名稱或運動型式錯誤');
  if(!Number.isInteger(c.ratio)||c.ratio<8||c.ratio>40||c.ratio!==c.roller_count)throw new HttpError(400,'傳動比須等於滾子數，範圍8至40');
  for(const k of FIELDS)if(k.endsWith('_mm')&&(!Number.isFinite(c[k])||c[k]<=0||c[k]>1000))throw new HttpError(400,'尺寸須大於0且不超過1000 mm：'+k);
  if(typeof c.check_interference!=='boolean'||typeof c.material!=='string'||c.material.length>80||/[\x00-\x1f]/.test(c.material))throw new HttpError(400,'材料或檢查設定錯誤');
  if(!(c.cam_root_mm>25&&c.cam_root_mm<c.cam_od_mm&&c.cam_od_mm<=75)||c.cam_width_mm<30||c.shaft_length_mm<71+c.cam_width_mm+40)throw new HttpError(400,'凸輪／軸尺寸不成立');
  if(c.chamfer_mm>=Math.min(2,(c.cam_od_mm-c.cam_root_mm)/4)||c.plate_bore_mm<50||c.plate_bore_mm>75)throw new HttpError(400,'倒角或盤孔尺寸不成立');
  if(Math.abs(c.roller_total_length_mm-c.plate_thickness_mm-c.roller_working_width_mm-2.65)>.001)throw new HttpError(400,'滾子軸向尺寸不成立');
  c.dwg_converter='';c.require_dwg=false;
  return {job_id:body.job_id,requirements:c};
}
export function createBroker({token,repo='maxjimtech/maxjimtech.github.io',branch='main',dailyLimit=4,cooldownSeconds=300,fetchImpl=fetch,now=()=>Date.now()}={}){
  if(!token)throw new HttpError(503,'免登入雲端服務尚未設定管理端授權');
  if(repo!=='maxjimtech/maxjimtech.github.io'||branch!=='main')throw new HttpError(503,'後端儲存庫設定不符');
  if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>4||!Number.isInteger(cooldownSeconds)||cooldownSeconds<60)throw new HttpError(503,'後端用量設定無效');
  const prefix='/repos/'+repo;
  async function gh(path,{method='GET',body,raw=false}={}){
    const r=await fetchImpl('https://api.github.com'+prefix+path,{method,headers:{Authorization:'Bearer '+token,Accept:raw?'application/vnd.github.raw+json':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
    if(!r.ok){const e=new HttpError(r.status,'GitHub 雲端連線失敗');e.github=true;throw e;}
    return r.status===204?null:r.json();
  }
  async function getQuota(){
    try{const f=await gh('/contents/rate-limit.json?ref=cad-control');return {sha:f.sha,data:JSON.parse(Buffer.from(f.content,'base64').toString('utf8'))};}
    catch(e){if(e.status!==404)throw e;return {sha:null,data:{day:'',count:0,last:0,requests:[]}};}
  }
  async function ensureControlBranch(){
    try{await gh('/git/ref/heads/cad-control');}
    catch(e){if(e.status!==404)throw e;const head=await gh('/git/ref/heads/main');try{await gh('/git/refs',{method:'POST',body:{ref:'refs/heads/cad-control',sha:head.object.sha}});}catch(e){if(e.status!==422)throw e;}}
  }
  async function putQuota(record,data){
    return gh('/contents/rate-limit.json',{method:'PUT',body:{message:'Reserve anonymous CAD budget',branch:'cad-control',...(record.sha?{sha:record.sha}:{}),content:Buffer.from(JSON.stringify(data)).toString('base64')}});
  }
  async function mark(id,state){
    for(let attempt=0;attempt<4;attempt++){
      const record=await getQuota();const data={...record.data,requests:record.data.requests.map(x=>x.id===id?{...x,state}:x)};
      try{await putQuota(record,data);return;}catch(e){if(![409,422].includes(e.status)||attempt===3)throw e;}
    }
  }
  async function submit(raw,ip){
    const input=validateRequest(raw),time=now(),day=new Date(time+8*60*60*1000).toISOString().slice(0,10);
    const payloadHash=createHash('sha256').update(JSON.stringify(input.requirements,Object.keys(input.requirements).sort())).digest('hex');
    const client=createHmac('sha256',token).update(String(ip)).digest('hex').slice(0,24);
    await ensureControlBranch();let reserved=false;
    for(let attempt=0;attempt<5;attempt++){
      const record=await getQuota(),data=record.data;
      if(!Array.isArray(data.requests)||!Number.isFinite(data.count)||!Number.isFinite(data.last))throw new HttpError(503,'雲端用量紀錄無效');
      const old=data.requests.find(x=>x.id===input.job_id);
      if(old){if(old.payloadHash!==payloadHash||old.client!==client)throw new HttpError(409,'工作編號已使用');if(old.state!=='submitted')throw new HttpError(503,'此工作編號已保留，派送狀態待管理者查核');return {job_id:input.job_id,project:input.requirements.project,status:'submitted',replayed:true};}
      const count=data.day===day?data.count:0;
      if(count>=dailyLimit)throw new HttpError(429,'全站今日 '+dailyLimit+' 次生成額度已用完，台灣時間午夜重置；需要增加使用次數，請聯絡 0931675001');
      if(time-data.last<cooldownSeconds*1000)throw new HttpError(429,'雲端生成間隔至少 '+cooldownSeconds+' 秒，請稍後再試');
      for(const state of ['in_progress','queued']){
        const runs=await gh('/actions/workflows/cad.yml/runs?status='+state+'&per_page=1');
        if(runs.total_count>0)throw new HttpError(429,'雲端目前正在建模，完成後可提交下一組');
      }
      const updated={day,count:count+1,last:time,requests:[{id:input.job_id,payloadHash,client,time,state:'reserved'},...data.requests].slice(0,100)};
      try{await putQuota(record,updated);reserved=true;break;}catch(e){if(![409,422].includes(e.status)||attempt===4)throw e;}
    }
    if(!reserved)throw new HttpError(429,'雲端忙碌，請稍後再試');
    // Reservation is durable before dispatch. A failed dispatch consumes its slot
    // rather than allowing unlimited retries; reruns are an administrator action.
    let response;
    try{response=await gh('/actions/workflows/cad.yml/dispatches',{method:'POST',body:{ref:branch,inputs:{job_id:input.job_id,requirements:JSON.stringify(input.requirements)}}});}
    catch{await mark(input.job_id,'dispatch_failed').catch(()=>{});throw new HttpError(502,'雲端工作未能啟動；已保留工作編號，請管理者查核');}
    await mark(input.job_id,'submitted').catch(()=>{});
    return {job_id:input.job_id,project:input.requirements.project,status:'submitted',run_id:response?.workflow_run_id,run_url:response?.html_url};
  }
  async function status(job){
    if(!UUID.test(job))throw new HttpError(400,'無效工作編號');
    try{return await gh('/contents/'+job+'/result.json?ref=cad-results',{raw:true});}catch(e){if(e.status!==404)throw e;}
    const data=await gh('/actions/workflows/cad.yml/runs?event=workflow_dispatch&per_page=100');
    const r=data.workflow_runs.find(x=>x.display_title==='CAD '+job);
    if(!r)return {job_id:job,status:'submitted'};
    return {job_id:job,status:r.status==='completed'?(r.conclusion==='success'?'completed':r.conclusion==='cancelled'?'cancelled':'failed'):r.status,run_id:r.id,run_url:r.html_url};
  }
  return {submit,status};
}
