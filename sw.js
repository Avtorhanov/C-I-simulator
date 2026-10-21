/* Офлайн-кэш. При изменении файлов поднять VERSION. */
const VERSION = 'cis-0.3.1';
const FILES = [
  './', './index.html', './manifest.webmanifest', './core/theme.css', './core/sim-core.js', './units/index.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './units/esd-ball-rp/index.html', './units/esd-ball-rp/unit.css', './units/esd-ball-rp/sim.js', './units/esd-ball-rp/details.js', './units/esd-ball-rp/scene.js',
  './units/ctl-globe-diaph/index.html', './units/ctl-globe-diaph/unit.css', './units/ctl-globe-diaph/scene.js'
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match('./index.html'))));
});
