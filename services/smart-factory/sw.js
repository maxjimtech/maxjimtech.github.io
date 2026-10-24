const CACHE_PREFIX = 'maxjim-smart-factory-';
const CACHE_NAME = CACHE_PREFIX + 'v2.0-i18n-20261024-r1';
const LOCAL_ASSETS = ['./', './index.html', './locales/ui.json', '../shared/maxjim-i18n.js', './maxjimtech_factory_3d.html', './manifest.json', './icon-192.png', './icon-512.png', './icon.ico', './sample_projects/CNC_Robot_Cell_Project.json'];
const CDN_ASSETS = ['https://cdn.tailwindcss.com/3.4.17', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(LOCAL_ASSETS);
  await Promise.allSettled(CDN_ASSETS.map(url => cache.add(url)));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const sharedRuntime = new URL('../shared/maxjim-i18n.js', self.registration.scope).href;
  if (!url.href.startsWith(self.registration.scope) && url.href !== sharedRuntime && !CDN_ASSETS.includes(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if(event.request.mode === 'navigate' || url.pathname.endsWith('/locales/ui.json') || url.href === sharedRuntime) {
      try { const response=await fetch(event.request); if(response.ok)await cache.put(event.request,response.clone()); return response; }
      catch(error) { const saved=await cache.match(event.request); if(saved)return saved; throw error; }
    }
    return await cache.match(event.request) || fetch(event.request);
  })());
});
