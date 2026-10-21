// Strict FANUC-style three-axis G00/G01 reader for visual stock removal only.
// It never sends NC to a controller, guesses an unsupported motion, or executes macros.
const finite=(value,name,lo=-10000,hi=10000)=>{
 if(typeof value!=='number'||!Number.isFinite(value)||value<lo||value>hi)throw Error(`${name} 超出模擬可接受範圍`);
 return value;
};

export function parseGcode(source,catalog,{default_tool='em6',initial_x=0,initial_y=0,initial_z=10,machine='vmc400'}={}){
 if(typeof source!=='string'||new TextEncoder().encode(source).length>3*1024*1024)throw Error('G-code 檔案需為 UTF-8 文字且不超過 3 MB');
 const lines=source.replace(/\r\n?/g,'\n').split('\n');
 if(lines.length>120000)throw Error('G-code 超過 120,000 行上限');
 const allTools=new Map(catalog.tools.map(t=>[t.number,t]));
 const defaultTool=catalog.tools.find(t=>t.id===default_tool);
 const machineData=catalog.machines.find(m=>m.id===machine);
 if(!defaultTool||!machineData)throw Error('選用刀具或母機不存在');
 let activeTool=defaultTool,preparedTool=null,unit=1,absolute=true,motion=null,feed=null,rpm=0;
 let position=[finite(initial_x,'初始 X',-10000,10000),finite(initial_y,'初始 Y',-10000,10000),finite(initial_z,'初始刀尖 Z',-500,500)];
 const positionAtStart=[...position];
 let ended=false,toolComp=false,firstActualTool=false;
 const warnings=[],moves=[],operations=[],tasks=[],seenToolNumbers=new Set();
 let activeOperation=-1;
 for(let row=0;row<lines.length;row++){
  let line=lines[row];const lineNo=row+1;
  if(line.length>1200)throw Error(`第 ${lineNo} 行太長`);
  // Parenthesized FANUC comments and trailing semicolon comments carry no motion.
  let depth=0,clean='';
  for(const ch of line){
   if(ch==='('){if(depth)throw Error(`第 ${lineNo} 行註解括號巢狀`);depth=1;continue;}
   if(ch===')'){if(!depth)throw Error(`第 ${lineNo} 行註解括號不完整`);depth=0;continue;}
   if(!depth){if(ch===';')break;clean+=ch;}
  }
  if(depth)throw Error(`第 ${lineNo} 行註解括號未結束`);
  const code=clean.trim().toUpperCase();
  if(!code||code==='%')continue;
  if(ended){warnings.push(`M30/M02 後另有程式，已忽略第 ${lineNo} 行以後內容。`);break;}
  if(/[\[\]#\/]/.test(code))throw Error(`第 ${lineNo} 行含巨集、條件式或選擇執行，無法安全模擬`);
  let compact=code.replace(/\s+/g,''),words=[],index=0;
  const token=/([A-Z])([+-]?(?:\d+(?:\.\d*)?|\.\d+))/y;
  while(index<compact.length){
   token.lastIndex=index;const match=token.exec(compact);
   if(!match)throw Error(`第 ${lineNo} 行無法解析：「${compact.slice(index,Math.min(index+24,compact.length))}」`);
   const val=Number(match[2]);finite(val,`第 ${lineNo} 行 ${match[1]}`);
   words.push({key:match[1],value:val});index=token.lastIndex;
  }
  if(words.length>32)throw Error(`第 ${lineNo} 行指令過多`);
  const codes=words.filter(w=>w.key==='G').map(w=>w.value);
  const mcodes=words.filter(w=>w.key==='M').map(w=>w.value);
  if(codes.includes(2)||codes.includes(3))throw Error(`第 ${lineNo} 行 G02／G03 圓弧尚未支援；不得以直線取代`);
  for(const w of words){
   if(!'NGMOTXYZFSH'.includes(w.key))throw Error(`第 ${lineNo} 行 ${w.key} 軸／補正／循環指令尚未支援`);
   if('NGMOTH'.includes(w.key)&&!Number.isInteger(w.value))throw Error(`第 ${lineNo} 行 ${w.key} 編號不是整數`);
  }
  if(codes.filter(x=>x===0||x===1).length>1)throw Error(`第 ${lineNo} 行同時指定 G0／G1`);
  if(codes.filter(x=>x===20||x===21).length>1||codes.filter(x=>x===90||x===91).length>1)
   throw Error(`第 ${lineNo} 行單位或座標模式互相衝突`);
  if(mcodes.length!==new Set(mcodes).size)throw Error(`第 ${lineNo} 行重複 M 指令`);
  if(mcodes.some(x=>x===2||x===30||x===6)&&words.some(w=>'XYZ'.includes(w.key)))
   throw Error(`第 ${lineNo} 行換刀／結束程式不可同時含座標移動`);
  for(const g of codes){
   if(g===0||g===1)motion=g===0?'G0':'G1';
   else if(g===20)unit=25.4;
   else if(g===21)unit=1;
   else if(g===90)absolute=true;
   else if(g===91)absolute=false;
   else if(g===43){toolComp=true;}
   else if(g===49){toolComp=false;}
   else if([17,40,54,80,94].includes(g)){}
   else throw Error(`第 ${lineNo} 行 G${g} 尚未支援（弧線、刀徑補正、固定循環、G53/G28 等需專用解析）`);
  }
  const one=letter=>{
   const group=words.filter(w=>w.key===letter);
   if(group.length>1)throw Error(`第 ${lineNo} 行重複 ${letter}`);
   return group[0]?.value;
  };
  const requested=one('T');if(requested!==undefined){
   preparedTool=allTools.get(requested);
   if(!preparedTool)throw Error(`第 ${lineNo} 行 T${requested} 未列於刀具資料庫；請新增刀具後再模擬`);
  }
  for(const m of mcodes){
   if(m===6){
    if(!preparedTool)throw Error(`第 ${lineNo} 行 M06 缺少有效 T 刀具編號`);
    activeTool=preparedTool;firstActualTool=true;activeOperation=-1;
   }else if(m===2||m===30)ended=true;
   else if(![0,1,3,4,5,7,8,9].includes(m))throw Error(`第 ${lineNo} 行 M${m} 尚未支援`);
  }
  const h=one('H');
  if(h!==undefined&&h!==activeTool.number)warnings.push(`第 ${lineNo} 行 H${h} 與 T${activeTool.number} 不同，刀長補正需依母機確認。`);
  const f=one('F');if(f!==undefined)feed=finite(f*unit,`第 ${lineNo} 行進給`,.01,60000);
  const s=one('S');if(s!==undefined)rpm=finite(s,`第 ${lineNo} 行轉速`,0,60000);
  const target=[...position];let hasAxis=false;
  for(let axis=0;axis<3;axis++){
   const x=one('XYZ'[axis]);
   if(x!==undefined){target[axis]=finite((absolute?0:position[axis])+x*unit,`第 ${lineNo} 行座標`);hasAxis=true;}
  }
  if(!hasAxis)continue;
  if(!motion)throw Error(`第 ${lineNo} 行帶有座標但未指定 G00/G01 運動模式`);
  if(motion==='G1'&&!(feed>0))throw Error(`第 ${lineNo} 行進給刀路缺少有效 F 值`);
  if(target.every((v,i)=>Math.abs(v-position[i])<1e-7))continue;
  if(moves.length>=80000)throw Error('G-code 超過 80,000 段刀路上限');
  if(activeOperation<0){
   activeOperation=operations.length;
   operations.push({id:activeOperation,title:`T${activeTool.number} · ${activeTool.name}`,tool:activeTool.id,rpm:Math.round(rpm),feed:feed||0,start:moves.length});
   seenToolNumbers.add(activeTool.number);
  }
  moves.push({a:[...position],b:target,mode:motion,tool:activeTool.id,feed:motion==='G0'?0:feed,op:activeOperation,line:lineNo});
  position=target;
 }
 if(!moves.length)throw Error('G-code 未包含有效的 G00/G01 刀具移動');
 if(!moves.some(m=>m.mode==='G1'))warnings.push('程式只有快速移動 G00，沒有實際切削進給 G01。');
 warnings.push(`初始刀尖位置假設為 G54 X${positionAtStart[0]} Y${positionAtStart[1]} Z${positionAtStart[2]} mm；請與原始程式的起始位置及刀長補正核對。`);
 if(toolComp)warnings.push('G43/H 刀長補正僅辨識指令；模擬座標視為實際刀尖座標，未套用母機 H 偏置。');
 if(!firstActualTool)warnings.push(`未找到 Txx M06 換刀指令，全部刀路依使用者選定的 ${defaultTool.name} 模擬。`);
 warnings.push('僅支援三軸直線 G00/G01 與指定的模態碼。忽略主軸轉動、刀具偏擺、切削力與機台控制器動作。');
 tasks.push({title:'匯入 G-code 並驗證語法',detail:`解析 ${lines.length} 行，${moves.length} 段運動，${seenToolNumbers.size||1} 種刀具`});
 tasks.push({title:'刀具與材料幾何除料',detail:'依選用素材、球刀／平刀／鑽頭幾何，以高度網格計算逐步去除體積'});
 return {id:crypto.randomUUID().replaceAll('-',''),source:'IMPORTED_GCODE',settings:{resolved_machine:{...machineData},machine:machineData.id},tasks,operations,moves,blockers:[],warnings,collisions:[],status:'DRAFT',strategy:'imported_linear',ai:{status:'RULES_ENGINE',executed:false,message:'讀入檔案後由指令解析與數值模擬；未使用模型生成刀路。'},nc:source,source_lines:lines.length};
}
