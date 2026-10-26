// Service worker «Призрака Огнеборода»: игру можно установить как приложение,
// а картинки, шрифты и код хранятся на устройстве — повторный запуск мгновенный.
// Файл собирается командой: python3 tools/build_sw.py
const VERSION = '__VERSION__';
const CACHE = 'ognebord-v2-' + VERSION;
const FILES = __FILES__;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('ognebord-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const FRESH = /\.(html|js|css|json|webmanifest)$/;

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // серверы связи, Supabase и т. п. — мимо
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;

  const isPage = req.mode === 'navigate' || FRESH.test(url.pathname) || url.pathname.endsWith('/');
  if (isPage) {
    // Код и страницы: сначала сеть (чтобы приходили обновления), без сети — из кэша.
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(req, { signal: ctrl.signal, cache: 'no-cache' });
        clearTimeout(t);
        if (res.ok) cache.put(url.pathname, res.clone());
        return res;
      } catch (err) {
        return (await cache.match(url.pathname)) || (await cache.match(req, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }
  // Картинки, шрифты, звук: сначала кэш.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
