// Service worker: lets the game be installed as an app.
// Network first, so players always get the latest version; the cache is only a fallback.
const CACHE = 'mutiny-rush-v1';
const SHELL = ['/', '/index.html', '/css/style.css', '/manifest.json', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never touch the live game connection or other sites.
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/socket.io')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
