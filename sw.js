// Offline cache: the whole app is static, so cache-first after the first load.
const CACHE = 'century-engine-v2';
const ASSETS = ['./', './index.html', './css/style.css', './js/main.js', './js/rng.js', './js/names.js', './js/storage.js', './js/sim/defs.js', './js/sim/gen.js', './js/sim/sim.js', './js/sim/history.js', './js/sim/branches.js', './js/render/renderer.js', './js/render/renderer3d.js', './vendor/three.module.js', './vendor/OrbitControls.js', './js/ui/panels.js', './manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; }).catch(() => hit)));
});
