/* Marginalia — service worker
   Predpomni lupino aplikacije (HTML/CSS/JS/ikone/Chart.js), da se odpre
   takoj in tudi brez povezave. Podatki tečejo mimo — Firestore ima svoj
   predpomnilnik, klici na Google in Apple pa gredo vedno na omrežje.

   Ob spremembi datotek dvigni številko v CACHE (v1 -> v2 ...), da se stari
   predpomnilnik počisti. */

const CACHE = 'marginalia-v2';

const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase.js',
  './utils.js',
  './lookups.js',
  './quotes.js',
  './manifest.webmanifest',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './vendor/chart.umd.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Firebase, Google, pisave — pusti pri miru

  // stale-while-revalidate: takoj vrni iz predpomnilnika, v ozadju osveži
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then(res => {
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
