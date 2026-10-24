/* Nested display labels only. Original design values and export text are never changed. */
(() => {
  'use strict';
  const titleSource = document.title;
  const sourceNodes = new WeakMap();
  const regions = ["bomTableBody"];
  const modelLabels = {
  "al_5083": "5083-H116 航太船用鋁合金",
  "cfrp_3k": "3K 碳纖維真空灌注複合材",
  "frp_marine": "海事級 GFRP 玻纖複合材",
  "hdpe_rotomold": "HDPE 高密度耐衝擊聚乙烯",
  "stealth_faceted": "匿蹤多切面戰術儀器艙",
  "streamlined_aero": "流線型低風阻水滴艙罩",
  "modular_utility": "模組化開放式鋁擠型載台",
  "tactical_grey": "海軍戰術低視度灰 (Naval Grey)",
  "survey_orange": "水文測繪高視認橘白 (Survey Orange)",
  "stealth_carbon": "消光暗夜碳纖黑 (Stealth Black)",
  "coastguard_blue": "海巡深海藍白 (Maritime Blue)",
  "dual_rtk_ins": "雙天線 RTK-GNSS 定向基線 + 光纖慣導 (FOG INS, 航向精度 0.05°)",
  "triple_gnss_crpa": "抗干擾 CRPA 陣列衛星導航 + 戰術級慣導 (抗電子干擾)",
  "single_gnss_ahrs": "單天線多星系 GNSS + MEMS AHRS 姿態航向參考系統",
  "dual_eoir_lrf": "三軸陀螺穩定四合一球型雲台 (30x光學 + 640熱成像 + 雷射測距)",
  "compact_eoir": "輕量化雙軸雙光光電球 (HD夜視 + 384熱像儀)",
  "none": "無水下聲納系統",
  "lidar_128": "海事級 128 線長距旋轉/固態 LiDAR (含疏水光學防護罩, 250m)",
  "lidar_dual32": "左右雙側傾斜 32 線廣角避障 LiDAR (自動靠泊專用)",
  "multibeam_gondola": "船底聲納導流罩 (Gondola) + 多波束測深儀 (Multibeam Echo Sounder)",
  "sidescan_dual": "船底雙頻側掃聲納陣列 (Dual-Frequency Side-Scan Sonar)",
  "fls_bow": "船艏前視三維避障聲納 (Forward-Looking Obstacle Avoidance Sonar)",
  "standard": "標準工程精度 (機構組裝快速載入)",
  "high": "高密流體曲面精度 (精細站位 Loft B-Rep)",
  "monohull_deepv": "深V破浪單體船",
  "catamaran": "雙體穩定工作船",
  "trimaran": "三體穿浪長航船",
  "swath": "小水線面雙體船",
  "lifepo4_pure": "純電磷酸鐵鋰高壓動力電池組 (LiFePO4 96V/400V)",
  "diesel_electric": "柴電串聯混合動力系統 (Marine Turbo-Diesel + LiFePO4)",
  "hydrogen_pem": "氫燃料電池混合系統 (PEM Fuel Cell + 350bar 儲氫瓶)",
  "solar_hybrid": "甲板太陽能陣列 + 儲能電池組 (Solar Array + LiFePO4)",
  "twin_waterjet": "雙噴水推進器 (Twin Mixed-Flow Waterjets)",
  "twin_azimuth_pod": "雙導流罩全迴轉吊艙推進器 (Twin Azimuth Pods)",
  "twin_shaft_prop": "雙軸五葉斜交螺旋槳 + 雙平衡舵 (Twin Shafts + Rudders)",
  "surface_piercing": "半浸式表面穿刺推進槳 (Surface-Piercing Drives)",
  "starlink_flat": "低軌衛星平板相控陣終端 (LEO Flat-Panel Maritime)",
  "satcom_dome": "高增益三軸追蹤衛通圓頂天線 (Ku/Ka-Band VSAT Dome)",
  "tactical_mimo": "戰術 MIMO COFDM 寬頻自組網陣列 (4x4 Mesh Array)",
  "solid_state_radome": "X波段固態脈衝壓縮雷達罩 (24\" Solid-State Doppler Radome)",
  "open_array_xband": "開放式旋轉陣列搜索雷達 (4ft Open-Array X-Band Scanner)",
  "phased_array_4d": "四面固態相控陣戰術偵蒐雷達 (4-Face Active AESA Mast)",
  "mmwave_array": "77GHz 毫米波 4D 環視避障雷達陣列 (4x Corner mmWave)"
};
  let observer, pending = false;
  const normalize = value => String(value).replace(/\s+/g,' ').trim();
  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  let dictionary, patterns = [];
  function prepare() {
    dictionary = window.MaxjimI18n?.getDictionary?.() || {};
    patterns = Object.keys(dictionary).filter(key => /\{\d+\}/.test(key)).map(key => {
      const slots = []; let pattern = '', offset = 0;
      for (const token of key.matchAll(/\{\d+\}/g)) {pattern += escapeRegex(key.slice(offset,token.index))+'(.+?)';offset=token.index+token[0].length;slots.push(token[0]);}
      pattern += escapeRegex(key.slice(offset));
      return {key,slots,regex:new RegExp('^'+pattern+'$')};
    }).sort((a,b)=>b.key.replace(/\{\d+\}/g,'').length-a.key.replace(/\{\d+\}/g,'').length);
  }
  function text(value, depth=0) {
    const api=window.MaxjimI18n, lang=api?.getLanguage() || 'zh', source=normalize(value);
    if(depth>8 || !api) return value;
    const label=modelLabels[source];
    if(label) return lang==='zh' ? label : text(label,depth+1);
    if(lang==='zh')return value;
    if(dictionary[source])return String(value).replace(source,dictionary[source][lang] || source);
    // A metric is often enclosed by the badge/BOM markup. Only unwrap an
    // entire balanced pair, so parentheses within engineering text stay intact.
    if(source.startsWith('(') && source.endsWith(')')) {
      let balance=0, enclosesWhole=true;
      for(let i=0;i<source.length;i++) {
        if(source[i]==='(')balance++;else if(source[i]===')')balance--;
        if(balance<0 || (balance===0 && i<source.length-1)){enclosesWhole=false;break;}
      }
      if(enclosesWhole && balance===0)return String(value).replace(source,'('+text(source.slice(1,-1),depth+1)+')');
    }
    for(const entry of patterns) {
      const match=source.match(entry.regex);if(!match)continue;
      const target=dictionary[entry.key][lang] || entry.key;
      const fields=Object.fromEntries(entry.slots.map((slot,i)=>[slot,text(match[i+1],depth+1)]));
      return String(value).replace(source,target.replace(/\{\d+\}/g,slot=>fields[slot]));
    }
    if(source.includes(' ｜ '))return String(value).replace(source,source.split(' ｜ ').map(s=>text(s,depth+1)).join(' ｜ '));
    // USV BOM rows can contain several engineering identifiers in one cell.
    // Replace their visible descriptions here, leaving the BOM objects intact.
    const described=String(value).replace(/\b[a-z][a-z0-9_]*\b/g,token=>modelLabels[token]?text(modelLabels[token],depth+1):token);
    return api.t(described);
  }
  function render() {
    pending=false;if(!dictionary)return;
    observer?.disconnect();
    document.title=window.MaxjimI18n.t(titleSource);
    for(const id of regions){const root=document.getElementById(id);if(!root)continue;
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
      while((node=walker.nextNode())){if(node.parentElement?.closest('pre,code,textarea,input,[contenteditable=true]'))continue;
        const old=sourceNodes.get(node),current=node.nodeValue;
        const source=old&&current===old.rendered?old.source:current,next=text(source);
        sourceNodes.set(node,{source,rendered:next});if(current!==next)node.nodeValue=next;
      }
    }
    for(const id of regions){const root=document.getElementById(id);if(root)observer?.observe(root,{subtree:true,childList:true,characterData:true});}
  }
  function schedule(){if(!pending){pending=true;requestAnimationFrame(render);}}
  function start(){prepare();observer ||= new MutationObserver(schedule);render();}
  window.addEventListener('maxjim:i18n-ready',start);
  window.addEventListener('maxjim:language',()=>{if(dictionary)render();});
})();
