// Strict FANUC-style three-axis G00/G01/G02/G03 reader for visual stock removal.
// Circular and helical arcs are converted to bounded chord-error segments before simulation.
const TAU=Math.PI*2;
const finite=(value,name,lo=-10000,hi=10000)=>{
 if(typeof value!=='number'||!Number.isFinite(value)||value<lo||value>hi)throw Error(`${name} 超出模擬可接受範圍`);
 return value;
};
const modTau=value=>((value%TAU)+TAU)%TAU;
const planeData=plane=>plane==='G17'?{u:0,v:1,w:2,letters:['I','J']}:plane==='G18'?{u:0,v:2,w:1,letters:['I','K']}:{u:1,v:2,w:0,letters:['J','K']};

function arcSweep(start,end,center,cw,fullCircle=false){
 const a0=Math.atan2(start[1]-center[1],start[0]-center[0]);
 const a1=Math.atan2(end[1]-center[1],end[0]-center[0]);
 if(fullCircle)return {start:a0,sweep:TAU,direction:cw?-1:1};
 const sweep=cw?modTau(a0-a1):modTau(a1-a0);
 if(sweep<1e-9)throw Error('圓弧起終點重合時必須使用 IJK 定義完整圓');
 return {start:a0,sweep,direction:cw?-1:1};
}

function radiusCenter(start,end,radius,cw,lineNo){
 const dx=end[0]-start[0],dy=end[1]-start[1],chord=Math.hypot(dx,dy),r=Math.abs(radius);
 if(chord<1e-9)throw Error(`第 ${lineNo} 行 R 圓弧不可用於完整圓`);
 if(r<chord/2-1e-6)throw Error(`第 ${lineNo} 行 R 半徑小於弦長的一半`);
 const mx=(start[0]+end[0])/2,my=(start[1]+end[1])/2;
 const h=Math.sqrt(Math.max(0,r*r-chord*chord/4)),nx=-dy/chord,ny=dx/chord;
 const candidates=[[mx+nx*h,my+ny*h],[mx-nx*h,my-ny*h]].map(center=>({center,...arcSweep(start,end,center,cw)}));
 const major=radius<0;
 return candidates.find(c=>major?c.sweep>Math.PI+1e-8:c.sweep<=Math.PI+1e-8) || candidates.sort((a,b)=>major?b.sweep-a.sweep:a.sweep-b.sweep)[0];
}

function tessellateArc(start,end,{plane,cw,centerWords,radius,centerAbsolute,tolerance,lineNo}){
 const {u,v,w,letters}=planeData(plane),p0=[start[u],start[v]],p1=[end[u],end[v]];
 const specified=letters.map(letter=>centerWords[letter]);
 const irrelevant=['I','J','K'].filter(letter=>!letters.includes(letter)&&centerWords[letter]!==undefined);
 if(irrelevant.length)throw Error(`第 ${lineNo} 行 ${plane} 圓弧不可使用 ${irrelevant.join('/')} 中心量`);
 if(radius!==undefined&&specified.some(v=>v!==undefined))throw Error(`第 ${lineNo} 行圓弧不可同時指定 R 與 IJK`);
 let geometry,center;
 if(radius!==undefined){
  if(!Number.isFinite(radius)||Math.abs(radius)<1e-9)throw Error(`第 ${lineNo} 行 R 半徑無效`);
  geometry=radiusCenter(p0,p1,radius,cw,lineNo);center=geometry.center;
 }else{
  if(specified.every(v=>v===undefined))throw Error(`第 ${lineNo} 行 G02/G03 缺少 ${letters.join('／')} 或 R 圓心資料`);
  center=specified.map((value,index)=>centerAbsolute?(value===undefined?p0[index]:value):(p0[index]+(value??0)));
  const r0=Math.hypot(p0[0]-center[0],p0[1]-center[1]),r1=Math.hypot(p1[0]-center[0],p1[1]-center[1]);
  if(r0<1e-7)throw Error(`第 ${lineNo} 行圓弧半徑為零`);
  const fullCircle=Math.hypot(p1[0]-p0[0],p1[1]-p0[1])<1e-7;
  if(!fullCircle&&Math.abs(r0-r1)>Math.max(.02,r0*.002))throw Error(`第 ${lineNo} 行 IJK 圓心至起終點半徑不一致`);
  geometry={center,...arcSweep(p0,p1,center,cw,fullCircle)};
 }
 const r=Math.hypot(p0[0]-center[0],p0[1]-center[1]);
 const chordAngle=2*Math.acos(Math.max(-1,Math.min(1,1-Math.min(tolerance,r)/r)));
 const stepAngle=Math.min(Math.PI/36,Number.isFinite(chordAngle)&&chordAngle>1e-6?chordAngle:Math.PI/180);
 const count=Math.max(1,Math.ceil(geometry.sweep/stepAngle));
 if(count>10000)throw Error(`第 ${lineNo} 行圓弧需要超過 10,000 段，請檢查半徑或單位`);
 const points=[];
 for(let i=1;i<=count;i++){
  const t=i/count,angle=geometry.start+geometry.direction*geometry.sweep*t,p=[...start];
  p[u]=center[0]+r*Math.cos(angle);p[v]=center[1]+r*Math.sin(angle);p[w]=start[w]+(end[w]-start[w])*t;
  if(i===count)p.splice(0,3,...end);
  points.push(p);
 }
 return {points,radius:r,sweep_rad:geometry.sweep,plane,cw,center:[...center],helical_mm:end[w]-start[w]};
}

export function parseGcode(source,catalog,{default_tool='em6',initial_x=0,initial_y=0,initial_z=10,machine='vmc400',arc_tolerance_mm=.05}={}){
 if(typeof source!=='string'||new TextEncoder().encode(source).length>3*1024*1024)throw Error('G-code 檔案需為 UTF-8 文字且不超過 3 MB');
 const lines=source.replace(/\r\n?/g,'\n').split('\n');
 if(lines.length>120000)throw Error('G-code 超過 120,000 行上限');
 const arcTolerance=finite(arc_tolerance_mm,'圓弧弦誤差',.005,1);
 const allTools=new Map(catalog.tools.map(t=>[t.number,t]));
 const defaultTool=catalog.tools.find(t=>t.id===default_tool);
 const machineData=catalog.machines.find(m=>m.id===machine);
 if(!defaultTool||!machineData)throw Error('選用刀具或母機不存在');
 let activeTool=defaultTool,preparedTool=null,unit=1,absolute=true,centerAbsolute=false,plane='G17',motion=null,feed=null,rpm=0;
 let position=[finite(initial_x,'初始 X',-10000,10000),finite(initial_y,'初始 Y',-10000,10000),finite(initial_z,'初始刀尖 Z',-500,500)];
 const positionAtStart=[...position];
 let ended=false,toolComp=false,firstActualTool=false,arcBlocks=0,arcSegments=0;
 const warnings=[],moves=[],operations=[],tasks=[],seenToolNumbers=new Set();
 let activeOperation=-1;
 const appendMove=(a,b,mode,lineNo,extra={})=>{
  if(moves.length>=80000)throw Error('G-code 細分後超過 80,000 段刀路上限');
  if(activeOperation<0){activeOperation=operations.length;operations.push({id:activeOperation,title:`T${activeTool.number} · ${activeTool.name}`,tool:activeTool.id,rpm:Math.round(rpm),feed:feed||0,start:moves.length});seenToolNumbers.add(activeTool.number);}
  moves.push({a:[...a],b:[...b],mode,tool:activeTool.id,feed:mode==='G0'?0:feed,op:activeOperation,line:lineNo,...extra});
 };
 for(let row=0;row<lines.length;row++){
  let line=lines[row];const lineNo=row+1;
  if(line.length>1200)throw Error(`第 ${lineNo} 行太長`);
  let depth=0,clean='';
  for(const ch of line){if(ch==='('){if(depth)throw Error(`第 ${lineNo} 行註解括號巢狀`);depth=1;continue;}if(ch===')'){if(!depth)throw Error(`第 ${lineNo} 行註解括號不完整`);depth=0;continue;}if(!depth){if(ch===';')break;clean+=ch;}}
  if(depth)throw Error(`第 ${lineNo} 行註解括號未結束`);
  const code=clean.trim().toUpperCase();if(!code||code==='%')continue;
  if(ended){warnings.push(`M30/M02 後另有程式，已忽略第 ${lineNo} 行以後內容。`);break;}
  if(/[\[\]#\/]/.test(code))throw Error(`第 ${lineNo} 行含巨集、條件式或選擇執行，無法安全模擬`);
  const compact=code.replace(/\s+/g,'');let words=[],index=0;const token=/([A-Z])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/y;
  while(index<compact.length){token.lastIndex=index;const match=token.exec(compact);if(!match)throw Error(`第 ${lineNo} 行無法解析：「${compact.slice(index,Math.min(index+24,compact.length))}」`);const val=Number(match[2]);finite(val,`第 ${lineNo} 行 ${match[1]}`);words.push({key:match[1],value:val});index=token.lastIndex;}
  if(words.length>32)throw Error(`第 ${lineNo} 行指令過多`);
  const codes=words.filter(w=>w.key==='G').map(w=>w.value),mcodes=words.filter(w=>w.key==='M').map(w=>w.value);
  for(const w of words){if(!'NGMOTXYZFSHIJKR'.includes(w.key))throw Error(`第 ${lineNo} 行 ${w.key} 軸／補正／循環指令尚未支援`);if('NMOTH'.includes(w.key)&&!Number.isInteger(w.value))throw Error(`第 ${lineNo} 行 ${w.key} 編號不是整數`);}
  if(codes.filter(x=>[0,1,2,3].includes(x)).length>1)throw Error(`第 ${lineNo} 行同時指定多個運動模式`);
  if(codes.filter(x=>x===20||x===21).length>1||codes.filter(x=>x===90||x===91).length>1||codes.filter(x=>x===90.1||x===91.1).length>1)throw Error(`第 ${lineNo} 行單位或座標模式互相衝突`);
  if(codes.filter(x=>[17,18,19].includes(x)).length>1)throw Error(`第 ${lineNo} 行圓弧平面模式互相衝突`);
  if(mcodes.length!==new Set(mcodes).size)throw Error(`第 ${lineNo} 行重複 M 指令`);
  if(mcodes.some(x=>x===2||x===30||x===6)&&words.some(w=>'XYZ'.includes(w.key)))throw Error(`第 ${lineNo} 行換刀／結束程式不可同時含座標移動`);
  for(const g of codes){if([0,1,2,3].includes(g))motion=`G${g}`;else if([17,18,19].includes(g))plane=`G${g}`;else if(g===20)unit=25.4;else if(g===21)unit=1;else if(g===90)absolute=true;else if(g===91)absolute=false;else if(g===90.1)centerAbsolute=true;else if(g===91.1)centerAbsolute=false;else if(g===43)toolComp=true;else if(g===49)toolComp=false;else if([40,54,80,94].includes(g)){}else throw Error(`第 ${lineNo} 行 G${g} 尚未支援（刀徑補正、固定循環、G53/G28 等需專用解析）`);}
  const one=letter=>{const group=words.filter(w=>w.key===letter);if(group.length>1)throw Error(`第 ${lineNo} 行重複 ${letter}`);return group[0]?.value;};
  const requested=one('T');if(requested!==undefined){preparedTool=allTools.get(requested);if(!preparedTool)throw Error(`第 ${lineNo} 行 T${requested} 未列於刀具資料庫；請新增刀具後再模擬`);}
  for(const m of mcodes){if(m===6){if(!preparedTool)throw Error(`第 ${lineNo} 行 M06 缺少有效 T 刀具編號`);activeTool=preparedTool;firstActualTool=true;activeOperation=-1;}else if(m===2||m===30)ended=true;else if(![0,1,3,4,5,7,8,9].includes(m))throw Error(`第 ${lineNo} 行 M${m} 尚未支援`);}
  const h=one('H');if(h!==undefined&&h!==activeTool.number)warnings.push(`第 ${lineNo} 行 H${h} 與 T${activeTool.number} 不同，刀長補正需依母機確認。`);
  const f=one('F');if(f!==undefined)feed=finite(f*unit,`第 ${lineNo} 行進給`,.01,60000);
  const s=one('S');if(s!==undefined)rpm=finite(s,`第 ${lineNo} 行轉速`,0,60000);
  const target=[...position];let hasAxis=false;
  for(let axis=0;axis<3;axis++){const value=one('XYZ'[axis]);if(value!==undefined){target[axis]=finite((absolute?0:position[axis])+value*unit,`第 ${lineNo} 行座標`);hasAxis=true;}}
  const centerWords={};for(const letter of ['I','J','K']){const value=one(letter);if(value!==undefined)centerWords[letter]=value*unit;}
  const radiusWord=one('R'),radius=radiusWord===undefined?undefined:radiusWord*unit,hasArcDefinition=radius!==undefined||Object.keys(centerWords).length>0;
  if(!hasAxis&&!((motion==='G2'||motion==='G3')&&hasArcDefinition))continue;
  if(!motion)throw Error(`第 ${lineNo} 行帶有座標但未指定運動模式`);
  if(motion!=='G2'&&motion!=='G3'&&hasArcDefinition)throw Error(`第 ${lineNo} 行 IJK/R 只能用於 G02/G03`);
  if(motion!=='G0'&&!(feed>0))throw Error(`第 ${lineNo} 行切削刀路缺少有效 F 值`);
  if(motion==='G0'||motion==='G1'){if(target.every((v,i)=>Math.abs(v-position[i])<1e-7))continue;appendMove(position,target,motion,lineNo);position=target;continue;}
  const arc=tessellateArc(position,target,{plane,cw:motion==='G2',centerWords,radius,centerAbsolute,tolerance:arcTolerance,lineNo});let last=[...position];arcBlocks++;
  for(let i=0;i<arc.points.length;i++){const point=arc.points[i];appendMove(last,point,'G1',lineNo,{source_mode:motion,arc_block:arcBlocks,arc_segment:i+1,arc_segments:arc.points.length});last=point;arcSegments++;}
  position=target;
 }
 if(!moves.length)throw Error('G-code 未包含有效的 G00/G01/G02/G03 刀具移動');
 if(!moves.some(m=>m.mode==='G1'))warnings.push('程式只有快速移動 G00，沒有實際切削進給。');
 if(arcBlocks)warnings.push(`${arcBlocks} 個 G02/G03 圓弧依最大 ${arcTolerance} mm 弦誤差細分為 ${arcSegments} 段後進行顯示與除料。`);
 warnings.push(`初始刀尖位置假設為 G54 X${positionAtStart[0]} Y${positionAtStart[1]} Z${positionAtStart[2]} mm；請與原始程式的起始位置及刀長補正核對。`);
 if(toolComp)warnings.push('G43/H 刀長補正僅辨識指令；模擬座標視為實際刀尖座標，未套用母機 H 偏置。');
 if(!firstActualTool)warnings.push(`未找到 Txx M06 換刀指令，全部刀路依使用者選定的 ${defaultTool.name} 模擬。`);
 warnings.push('支援三軸 G00/G01 與 G17/G18/G19 的 G02/G03（IJK、R、螺旋圓弧）；忽略主軸動態、刀具偏擺、切削力與控制器加減速。');
 tasks.push({title:'匯入 G-code 並驗證語法',detail:`解析 ${lines.length} 行，${moves.length} 段模擬運動，${arcBlocks} 個圓弧，${seenToolNumbers.size||1} 種刀具`});
 tasks.push({title:'刀具與材料幾何除料',detail:'依選用素材、球刀／平刀／鑽頭幾何，以高度網格計算逐步去除體積'});
 return {id:crypto.randomUUID().replaceAll('-',''),source:'IMPORTED_GCODE',settings:{resolved_machine:{...machineData},machine:machineData.id},tasks,operations,moves,blockers:[],warnings,collisions:[],status:'DRAFT',strategy:arcBlocks?'imported_arc_tessellated':'imported_linear',arc_summary:{blocks:arcBlocks,segments:arcSegments,tolerance_mm:arcTolerance},ai:{status:'RULES_ENGINE',executed:false,message:'讀入檔案後由指令解析與數值模擬；未使用模型生成刀路。'},nc:source,source_lines:lines.length};
}
