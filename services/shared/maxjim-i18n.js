/* MAXJIM display localization. Design state, input values and export schemas stay owned by each tool. */
(() => {
  'use strict';
  if (window.MaxjimI18n) return;
  const script = document.currentScript;
  const supported = ['zh', 'en', 'ja', 'de', 'fr'];
  const normalizeLanguage = value => {
    const base = String(value || '').toLowerCase().split(/[-_]/)[0];
    return supported.includes(base) ? base : null;
  };
  let saved;
  try { saved = localStorage.getItem('maxjim.language'); } catch (_) {}
  const requested = normalizeLanguage(new URL(location.href).searchParams.get('lang')) || normalizeLanguage(new URL(document.baseURI || location.href).searchParams.get('lang'));
  let language = requested || normalizeLanguage(saved) || 'zh';
  let dictionary = {}, aliases = new Map(), templates = [], fragments = [];
  const sources = new WeakMap(), attrSources = new WeakMap();
  let observer, scheduled = false, applying = false;
  const skip = 'script,style,textarea,input,pre,code,[contenteditable=true],[data-mj-no-translate],#mjLanguageBar';
  const normalizeText = value => String(value).replace(/\s+/g, ' ').trim();
  const hasCjk = value => /[\u3400-\u9fff]/.test(value);
  const resolveSource = value => {
    const own=Object.prototype.hasOwnProperty.call(dictionary,value),alias=aliases.get(value);
    if(own&&hasCjk(value))return value;
    if(alias&&hasCjk(alias))return alias;
    return own?value:alias||value;
  };
  function translated(source) {
    const key = resolveSource(source);
    return language === 'zh' ? key : dictionary[key]?.[language] || source;
  }
  function t(value) {
    if (value == null) return value;
    const source = String(value), normalized = normalizeText(source);
    const exact = translated(normalized);
    if (exact !== normalized) return source.replace(normalized, exact);
    for (const entry of templates) {
      const match = normalized.match(entry.regex);
      if (match) {
        let text = translated(entry.key);
        entry.placeholders.forEach((token, i) => { text = text.split(token).join(match[i + 1]); });
        return source.replace(normalized, text);
      }
    }
    // Fragment matching is limited to complete textual phrases; numbers and units are preserved.
    let result = source;
    for (const fragment of fragments) {
      if (result.includes(fragment)) result = result.split(fragment).join(translated(fragment));
    }
    return result;
  }
  function prepareDictionary() {
    aliases = new Map(); templates = [];
    for (const [key, values] of Object.entries(dictionary)) {
      for (const value of Object.values(values || {})) if (typeof value === 'string' && value) {
        const normalized=normalizeText(value),previous=aliases.get(normalized);
        if(!previous||(!hasCjk(previous)&&hasCjk(key)))aliases.set(normalized,key);
      }
      const tokens = key.match(/\{\d+\}/g);
      if (tokens) {
        let pattern = '', offset = 0;
        for (const match of key.matchAll(/\{\d+\}/g)) {
          pattern += key.slice(offset, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(.+?)';
          offset = match.index + match[0].length;
        }
        pattern += key.slice(offset).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        templates.push({ key, placeholders: tokens, regex: new RegExp('^' + pattern + '$') });
      }
    }
    fragments = Object.keys(dictionary).filter(k => !/\{\d+\}/.test(k) && k.length >= 2).sort((a,b) => b.length-a.length);
  }
  function translateTree() {
    if (applying || !document.body) return;
    applying = true;
    observer?.disconnect();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement || node.parentElement.closest(skip) || !node.nodeValue.trim()) continue;
      const current = node.nodeValue, old = sources.get(node);
      const source = old && current === old.rendered ? old.source : current;
      const next = t(source);
      sources.set(node, {source, rendered: next});
      if (current !== next) node.nodeValue = next;
    }
    document.querySelectorAll('[title],[placeholder],[aria-label],optgroup[label],img[alt],[data-i18n]').forEach(element => {
      if (element.closest('[data-mj-no-translate],#mjLanguageBar')) return;
      const data = attrSources.get(element) || {};
      for (const name of ['title','placeholder','aria-label','label','alt']) {
        if (!element.hasAttribute(name)) continue;
        const current = element.getAttribute(name), old = data[name];
        const source = old && current === old.rendered ? old.source : current;
        const next = t(source); data[name] = {source, rendered:next};
        if (next !== current) element.setAttribute(name,next);
      }
      attrSources.set(element,data);
    });
    document.documentElement.lang = language === 'zh' ? 'zh-Hant' : language;
    observer?.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label','label','alt']});
    applying = false;
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled=false;translateTree(); }); } }
  function setLanguage(next) {
    next = normalizeLanguage(next); if (!next) return;
    language = next;
    try {localStorage.setItem('maxjim.language',language);} catch (_) {}
    if (location.protocol.startsWith('http')) {
      const url = new URL(location.href);url.searchParams.set('lang',language);
      try {history.replaceState(null,'',url.href);} catch (_) {}
    }
    const select = document.getElementById('mjLanguageSelect');if(select)select.value=language;
    document.querySelectorAll('a[href]').forEach(a => {
      try {const url=new URL(a.getAttribute('href'),document.baseURI||location.href);const tool=url.pathname.startsWith('/services/')&&(url.hostname==='maxjimtech.github.io'||url.origin===location.origin);const portal=url.hostname==='maxjimtech.com'&&decodeURIComponent(url.pathname).includes('線上設計工具');if((tool||portal)&&!/\.(json|csv|zip|dxf|svg|png)$/i.test(url.pathname)){url.searchParams.set('lang',language);a.href=url.href;}} catch (_) {}
    });
    window.dispatchEvent(new CustomEvent('maxjim:language',{detail:{language}}));
    translateTree();
  }
  window.MaxjimI18n = {t,getLanguage:()=>language,setLanguage,refresh:schedule,getDictionary:()=>dictionary};
  const ctx = window.CanvasRenderingContext2D?.prototype;
  if (ctx) for (const method of ['fillText','strokeText']) {
    const original = ctx[method];
    ctx[method] = function(text,x,y,maxWidth) {
      const output=t(text);
      return maxWidth===undefined ? original.call(this,output,x,y) : original.call(this,output,x,y,maxWidth);
    };
  }
  function createSelector() {
    if (!document.getElementById('mjI18nStyle')) {
      const style=document.createElement('style');style.id='mjI18nStyle';style.textContent='#mjLanguageBar{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;margin:0;min-width:0;flex-shrink:0;grid-column:1/-1;background:#102035;color:#e2e8f0;border-bottom:1px solid #475569;font:12px/1.5 system-ui;z-index:45}#mjLanguageBar select{background:#0f172a;color:#fff;border:1px solid #64748b;padding:6px 8px;border-radius:5px;min-width:120px;max-width:100%}';document.head.append(style);
    }
    let bar=document.getElementById('mjLanguageBar');
    if(!bar){bar=document.createElement('nav');bar.id='mjLanguageBar';const header=document.querySelector('header');if(header)header.after(bar);else document.body.prepend(bar);}
    bar.setAttribute('aria-label','Language / 語言');
    const label=document.createElement('label');label.htmlFor='mjLanguageSelect';label.textContent='語言 / Language';
    const select=document.createElement('select');select.id='mjLanguageSelect';
    for(const [value,name] of [['zh','繁體中文'],['en','English'],['ja','日本語'],['de','Deutsch'],['fr','Français']]){const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option);}
    select.value=language;select.addEventListener('change',()=>setLanguage(select.value));bar.replaceChildren(label,select);
  }
  async function start() {
    createSelector();
    const url=script?.getAttribute('data-mj-locales');
    if(url){try {const response=await fetch(new URL(url,document.baseURI));if(!response.ok)throw Error('HTTP '+response.status);dictionary=await response.json();prepareDictionary();}catch(error){console.warn('MAXJIM language dictionary unavailable',error);}}
    observer=new MutationObserver(schedule);setLanguage(language);
    window.dispatchEvent(new CustomEvent('maxjim:i18n-ready',{detail:{language}}));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
