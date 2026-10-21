// MiniLM ranks bounded CNC choices; exact geometry, tool limits and NC are deterministic.
import {chooseMachine, gcode, validate} from './cam.mjs';

export const LITE_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const LITE_VERSION = '0.3.0-dev.2';
export const REVIEW_BLOCKER = 'MiniLM 語意建議尚未經人工審查；請核對母機、刀具與粗銑策略後確認。';

function cosine(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||a.length<2)throw Error('MiniLM 向量長度錯誤');
 let dot=0,aa=0,bb=0;
 for(let i=0;i<a.length;i++){
  if(!Number.isFinite(a[i])||!Number.isFinite(b[i]))throw Error('MiniLM 向量含非有限數值');
  dot+=a[i]*b[i];aa+=a[i]**2;bb+=b[i]**2;
 }
 if(aa===0||bb===0)throw Error('MiniLM 向量為零');
 return dot/Math.sqrt(aa*bb);
}

async function rank(key,prompt,options,embed){
 if(!options.length)throw Error(`${key} 沒有符合數值條件的候選選項`);
 if(options.length===1)return {choice:options[0].id,similarity:null,ranking:[{id:options[0].id,similarity:null}],method:'single-valid-choice'};
 const vectors=await embed([prompt,...options.map(v=>v.description)]);
 if(!Array.isArray(vectors)||vectors.length!==options.length+1)throw Error('MiniLM 推論回傳數量錯誤');
 const ranking=options.map((o,i)=>({id:o.id,similarity:cosine(vectors[0],vectors[i+1])})).sort((a,b)=>b.similarity-a.similarity);
 return {choice:ranking[0].id,similarity:ranking[0].similarity,ranking,method:'minilm-cosine-unvalidated'};
}

export async function recommendLite({model,settings,catalog,auto_machine},embed){
 if(!model?.supported)throw Error('STEP 幾何未通過支援檢查，MiniLM 不提出加工建議');
 validate(model,settings,catalog);
 if(typeof embed!=='function')throw Error('沒有可用的 MiniLM 推論引擎');
 const pockets=model.features.filter(f=>f.kind==='pocket'),holes=model.features.filter(f=>f.kind==='drill');
 const allowance=settings.stock_z-model.size[2],minimum=pockets.length?Math.min(...pockets.map(f=>Math.min(f.w,f.h))):Infinity;
 const maximum=pockets.length?Math.max(...pockets.map(f=>f.depth)):0;
 const tools=catalog.tools.filter(t=>t.kind==='endmill'&&pockets.every(f=>t.diameter<Math.min(f.w,f.h)&&t.flute_length>f.depth+allowance));
 if(!tools.length)throw Error('刀庫沒有可滿足口袋寬度及刃長的銑刀，請先補充刀庫');
 const material={al6061:'aluminum alloy 6061',s45c:'medium carbon steel S45C',sus304:'stainless steel SUS304'}[settings.material]||settings.material;
 const context=`Three-axis CNC milling: stock ${settings.stock_x} by ${settings.stock_y} by ${settings.stock_z} millimeters; `+
  `material ${material}; `+
  `${pockets.length} rectangular open pockets, narrowest width ${Number.isFinite(minimum)?minimum:'none'} mm, `+
  `deepest pocket ${maximum} mm; ${holes.length} vertical through holes. These are exact CAD features, not inferred by language.`;
 const tool=await rank('tool',`${context} Suggest a productive center-cutting end mill for pocket and face roughing; preserve small feature access.`,
  tools.map(t=>({id:t.id,description:`${t.diameter} millimeter diameter end mill with ${t.flute_length} mm cutting length. `+
  (t.diameter<=6?'Small cutter for narrow pocket access and details.':'Larger cutter for wider pockets and faster bulk stock removal.')})),embed);
 const provisional={...settings,tool:tool.choice},eligible=chooseMachine(model,provisional,catalog);
 if(!eligible.candidates.length)throw Error('目前母機行程均不足以涵蓋刀具／素材掃掠，無法推薦母機');
 const machine=await rank('machine',`${context} Select the smallest sufficient vertical machining center with safe travel capacity.`,
  eligible.candidates.map(id=>{const m=catalog.machines.find(m=>m.id===id);return {id,description:`${m.travel.join(' by ')} mm travel, ${m.rpm} rpm vertical machining center. `+
  (m.travel[0]<=400?'Compact small-workpiece milling machine.':m.travel[0]<=800?'Medium-size machining center.':'Large-envelope machining center.')}}),embed);
 const strategy=await rank('strategy',`${context} Choose an efficient rough pocket clearing method for these simple top-open rectangular pockets.`,[
  {id:'raster',description:'Parallel zigzag raster clearing. Efficient simple rectangular pockets, continuous straight cutting lanes.'},
  {id:'contour',description:'Concentric rectangular contour clearing with extra central raster passes for complete pocket clearing.'}
 ],embed);
 return {status:'MODEL_RESULT',model:LITE_MODEL,dtype:'q8',executed:false,review_required:true,
  answers:{tool,machine,strategy},allowed_machine_ids:eligible.candidates,allowed_tool_ids:tools.map(t=>t.id),
  model_input:'Derived feature dimensions and catalog descriptions only; no uploaded STEP bytes.',
  note:'Cosine similarity is not a calibrated confidence or CNC safety assessment. Geometry, tool limits and fixture checks remain deterministic.',
  feature_breakdown:{pockets:pockets.length,drills:holes.length,facing:allowance>0},
  effective_machine_selection:auto_machine?'miniLM-choice-with-human-review':'manually-locked'};
}

export function applyLiteAdvice(plan,advice){
 if(advice?.status!=='MODEL_RESULT'||!advice.review_required)throw Error('沒有可審查的 MiniLM 建議');
 if(!advice.allowed_tool_ids.includes(plan.settings.tool)||plan.settings.tool!==advice.answers.tool.choice)throw Error('建議銑刀與 CAM 計畫不一致');
 if(!['raster','contour'].includes(plan.strategy)||plan.strategy!==advice.answers.strategy.choice)throw Error('建議粗銑策略與 CAM 計畫不一致');
 if(advice.effective_machine_selection==='miniLM-choice-with-human-review'&&(!advice.allowed_machine_ids.includes(plan.settings.machine)||plan.settings.machine!==advice.answers.machine.choice))throw Error('建議母機與 CAM 計畫不一致');
 plan.ai=structuredClone(advice);
 plan.ai_review_blocker=REVIEW_BLOCKER;
 if(!plan.blockers.includes(REVIEW_BLOCKER))plan.blockers.push(REVIEW_BLOCKER);
 plan.status='BLOCKED';delete plan.nc;
 return plan;
}

export function confirmLiteReview(plan,catalog){
 if(plan?.ai?.status!=='MODEL_RESULT'||plan.ai.user_reviewed_at||!plan.blockers.includes(REVIEW_BLOCKER))throw Error('沒有等待確認的 MiniLM 建議');
 plan.blockers=plan.blockers.filter(b=>b!==REVIEW_BLOCKER);
 plan.ai.user_reviewed_at=new Date().toISOString();
 plan.status=plan.blockers.length?'BLOCKED':'DRAFT';
 if(!plan.blockers.length&&plan.moves.length)plan.nc=gcode(plan,catalog);
 else delete plan.nc;
 return plan;
}
