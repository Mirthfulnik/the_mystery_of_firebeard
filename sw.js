// Service worker «Призрака Огнеборода»: игру можно установить как приложение,
// а картинки, шрифты и код хранятся на устройстве — повторный запуск мгновенный.
// Файл собирается командой: python3 tools/build_sw.py
const VERSION = 'a09f70abc9';
const CACHE = 'ognebord-' + VERSION;
const FILES = [
 "./",
 "audio/files.json",
 "css/host.css",
 "css/player.css",
 "css/style.css",
 "fonts/caveat-cyrillic-700-normal.woff2",
 "fonts/caveat-latin-700-normal.woff2",
 "fonts/pt-serif-cyrillic-400-italic.woff2",
 "fonts/pt-serif-cyrillic-400-normal.woff2",
 "fonts/pt-serif-cyrillic-700-normal.woff2",
 "fonts/pt-serif-latin-400-italic.woff2",
 "fonts/pt-serif-latin-400-normal.woff2",
 "fonts/pt-serif-latin-700-normal.woff2",
 "fonts/yeseva-one-cyrillic-400-normal.woff2",
 "fonts/yeseva-one-latin-400-normal.woff2",
 "gm.html",
 "icons/apple-touch-icon.png",
 "icons/favicon-64.png",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/maskable-512.png",
 "img/bg/BG-01.webp",
 "img/bg/BG-02.webp",
 "img/bg/BG-03.webp",
 "img/bg/BG-04.webp",
 "img/bg/BG-05.webp",
 "img/bg/BG-06.webp",
 "img/bg/BG-07.webp",
 "img/bg/UI-02.webp",
 "img/bg/UI-08.webp",
 "img/bg/UI-09.webp",
 "img/ch/CH-01.webp",
 "img/ch/CH-01b.webp",
 "img/ch/CH-02.webp",
 "img/ch/CH-03.webp",
 "img/ch/CH-03b.webp",
 "img/ch/CH-04.webp",
 "img/ch/CH-05.webp",
 "img/ch/CH-06.webp",
 "img/ch/CH-07.webp",
 "img/ev/BADGE.webp",
 "img/ev/EV-02.webp",
 "img/ev/EV-04.webp",
 "img/ev/EV-05.webp",
 "img/ev/EV-06.webp",
 "img/ev/EV-07.webp",
 "img/ev/EV-08.webp",
 "img/ev/EV-09.webp",
 "img/ev/EV-10.webp",
 "img/ev/EV-13.webp",
 "img/ev/EV-14.webp",
 "img/ev/EV-15.webp",
 "img/ev/PAPER.webp",
 "img/ev/PHOTO.webp",
 "img/face/CH-01.webp",
 "img/face/CH-01b.webp",
 "img/face/CH-02.webp",
 "img/face/CH-03.webp",
 "img/face/CH-03b.webp",
 "img/face/CH-04.webp",
 "img/face/CH-05.webp",
 "img/face/CH-06.webp",
 "img/face/CH-07.webp",
 "img/sc/SC-01.webp",
 "img/sc/SC-02.webp",
 "img/sc/SC-03.webp",
 "img/sc/SC-04.webp",
 "img/sc/SC-05a.webp",
 "img/sc/SC-05b.webp",
 "index.html",
 "js/audio.js",
 "js/content.js",
 "js/game.js",
 "js/gm.js",
 "js/host.js",
 "js/net.js",
 "js/player.js",
 "js/pwa.js",
 "js/ui.js",
 "manifest.webmanifest",
 "play.html",
 "vendor/mqtt.min.js",
 "vendor/qrcode.js"
];

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
  if (!url.pathname.startsWith(scope.pathname) || url.pathname.startsWith(scope.pathname + 'catalog/')) return;

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
