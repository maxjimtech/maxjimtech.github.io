/* Nested display labels only. Original design values and export text are never changed. */
(() => {
  'use strict';
  const titleSource = document.title;
  const sourceNodes = new WeakMap();
  const regions = ['hud-config-badge','desc-suspension','desc-steering','desc-braking','desc-drivetrain','desc-power','alert-list','audit-matrix-grid','action-feedback-banner','bom-table-body'];
  const modelLabels = {};
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
