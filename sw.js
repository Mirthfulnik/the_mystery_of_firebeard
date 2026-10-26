// Раньше игра лежала в корне сайта и регистрировала здесь свой service worker.
// Теперь игра в папке ognebord/, а этот файл снимает старую регистрацию и её кэш.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('ognebord-') && !k.startsWith('ognebord-v2-')).map(k => caches.delete(k)));
    await self.registration.unregister();
  })());
});
