const CACHE='cad-cloud-2.1.0';
const FILES=['./','./index.html','./style.css','./app.js','./viewer.js','./guest.js','./manifest.webmanifest','./icon.svg','./defaults.json','./deployment.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('cad-cloud-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
// Cache only the public app shell. Never cache GitHub requests, tokens or CAD results.
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{if(r.ok&&FILES.some(p=>new URL(p,self.registration.scope).pathname===u.pathname)){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return r;}).catch(()=>caches.match(e.request).then(r=>r||new Response('離線。請連接網路以執行雲端工作。',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}}))));});
