// Рекламные места: шапка, левая колонка (только на широких экранах), низ экрана.
// Яндекс РСЯ или Google AdSense — что задано в config.js.
const A = (window.ULIKA_CONFIG || {}).ads || {};
const Y = A.yandex || {};
const G = A.google || {};

const SIZES = { top: 'баннер 728×90 · на телефоне 320×100', left: 'вертикальный 160×600 или 300×600', bottom: 'баннер 728×90 · на телефоне 320×50' };

let yLoaded = false, gLoaded = false;
function loadYandex() {
  if (yLoaded) return; yLoaded = true;
  window.yaContextCb = window.yaContextCb || [];
  const s = document.createElement('script'); s.src = 'https://yandex.ru/ads/system/context.js'; s.async = true;
  document.head.appendChild(s);
}
function loadGoogle() {
  if (gLoaded) return; gLoaded = true;
  const s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(G.client)}`;
  document.head.appendChild(s);
}

function pick(slot) {
  const y = Y[slot], g = G.client && G[slot];
  if (y && g) return A.prefer === 'google' ? 'google' : 'yandex';
  if (y) return 'yandex';
  if (g) return 'google';
  return null;
}

export function mountAds() {
  document.querySelectorAll('[data-ad]').forEach(el => {
    const slot = el.dataset.ad;
    const net = pick(slot);
    if (net === 'yandex') {
      loadYandex();
      const id = `yandex_rtb_${Y[slot]}`;
      el.innerHTML = `<div id="${id}"></div>`;
      window.yaContextCb.push(() => { window.Ya.Context.AdvManager.render({ blockId: Y[slot], renderTo: id }); });
      el.classList.add('ad-live');
    } else if (net === 'google') {
      loadGoogle();
      el.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${G.client}" data-ad-slot="${G[slot]}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      el.classList.add('ad-live');
    } else if (A.placeholders !== false) {
      el.innerHTML = `<div class="ad-ph"><b>Место для рекламы</b><span>${SIZES[slot]}</span></div>`;
    } else {
      el.hidden = true;
      // Без рекламы убираем и рамки вокруг: левую колонку и нижнюю панель
      const wrap = el.closest('.rail, .ad-bottom');
      if (wrap) wrap.hidden = true;
      if (slot === 'bottom') document.body.classList.remove('has-bottom-ad');
      if (slot === 'left') document.body.classList.add('no-rail');
    }
  });
  const close = document.querySelector('[data-ad-close]');
  if (close) close.addEventListener('click', () => { close.closest('.ad-bottom').hidden = true; document.body.classList.remove('has-bottom-ad'); });
}
