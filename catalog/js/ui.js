// Общее для всех страниц: шапка, поиск, «поделиться», навигация пультом.
import { GAMES } from './data.js';
import { track, live } from './api.js';
import { mountAds } from './ads.js';

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const num = n => n >= 10000 ? (n / 1000).toFixed(0) + ' тыс.' : n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + ' тыс.' : String(n);
export const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };

export const ICON = {
  eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1Z"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8Z"/></svg>',
  people: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM1 20c0-3.3 3.6-6 8-6s8 2.7 8 6v1H1Zm17 1v-1c0-1.7-.7-3.3-2-4.5 3.7.2 7 2.2 7 4.5v1Z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.6 3.6 2.1-1 1.7L11 13.6V6h2Z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8Z"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3Zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z"/></svg>',
};

export function header(active = '') {
  return `<a class="skip" href="#main">К содержимому</a>
  <header class="top">
    <a class="brand" href="index.html" aria-label="Улика — на главную"><span class="brand-mark">У</span><span class="brand-name">Улика</span><span class="brand-sub">детективные игры для вечеринок</span></a>
    <form class="search" role="search" action="index.html">
      <label class="sr" for="q">Поиск игр</label>${ICON.search}
      <input id="q" name="q" type="search" placeholder="Найти игру, тему или персонажа" autocomplete="off" value="${esc(new URLSearchParams(location.search).get('q') || '')}">
    </form>
    <nav class="topnav" aria-label="Разделы"><a href="index.html#all" ${active === 'all' ? 'aria-current="page"' : ''}>Все игры</a><a href="index.html#collections">Подборки</a></nav>
    <button class="tvbtn" type="button" data-tv aria-pressed="false" title="Крупный режим для телевизора">ТВ</button>
  </header>
  <div class="tape" aria-hidden="true"><span>Место преступления · не пересекать · Улика · Место преступления · не пересекать · Улика · Место преступления · не пересекать · Улика ·</span></div>
  <div class="ad ad-top" data-ad="top" aria-label="Реклама"></div>`;
}

export function footer() {
  return `<footer class="foot">
    <p>Улика — каталог детективных игр для вечеринок. ${GAMES.length} ${plural(GAMES.length, 'игра', 'игры', 'игр')} в каталоге.</p>
    ${live ? '' : '<p class="demo">Демо-режим: оценки, просмотры и комментарии сохраняются только в этом браузере, пока не подключена база.</p>'}
  </footer>
  <div class="ad-bottom"><div class="ad" data-ad="bottom" aria-label="Реклама"></div><button class="ad-x" data-ad-close aria-label="Скрыть рекламу">✕</button></div>`;
}

export function frame(active) {
  document.body.insertAdjacentHTML('afterbegin', header(active));
  document.body.insertAdjacentHTML('beforeend', footer());
  document.body.classList.add('has-bottom-ad');
  document.body.insertAdjacentHTML('beforeend', '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="half"><stop offset="50%" stop-color="#f2d40c"/><stop offset="50%" stop-color="#3a4256"/></linearGradient></defs></svg>');
  tvMode();
  mountAds();
  spatialNav();
}

// ---------- Поделиться ----------
export async function share(game, onDone) {
  const url = new URL(`game.html?id=${game.id}`, location.href).href;
  const text = `${game.title} — ${game.tagline}`;
  if (navigator.share) {
    try { await navigator.share({ title: game.title, text, url }); await track(game.id, 'share'); onDone && onDone(); } catch (e) { /* отменили */ }
    return;
  }
  openShareSheet(game, url, text, onDone);
}

function openShareSheet(game, url, text, onDone) {
  const u = encodeURIComponent(url), t = encodeURIComponent(text);
  const links = [
    ['Telegram', `https://t.me/share/url?url=${u}&text=${t}`],
    ['WhatsApp', `https://wa.me/?text=${t}%20${u}`],
    ['ВКонтакте', `https://vk.com/share.php?url=${u}`],
  ];
  const el = document.createElement('div');
  el.className = 'sheet-back';
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Поделиться игрой">
    <h3>Поделиться «${esc(game.title)}»</h3>
    <div class="share-links">${links.map(([n, h]) => `<a href="${h}" target="_blank" rel="noopener" data-sh>${n}</a>`).join('')}<button data-copy>Скопировать ссылку</button></div>
    <input class="share-url" value="${esc(url)}" readonly aria-label="Ссылка на игру">
    <button class="btn ghost" data-close>Закрыть</button></div>`;
  document.body.appendChild(el);
  const done = async () => { await track(game.id, 'share'); onDone && onDone(); };
  el.addEventListener('click', async e => {
    if (e.target === el || e.target.closest('[data-close]')) { el.remove(); return; }
    if (e.target.closest('[data-sh]')) { done(); setTimeout(() => el.remove(), 300); }
    if (e.target.closest('[data-copy]')) {
      try { await navigator.clipboard.writeText(url); } catch (er) { el.querySelector('.share-url').select(); document.execCommand('copy'); }
      e.target.textContent = 'Ссылка скопирована'; done();
    }
  });
  el.querySelector('[data-copy]').focus();
  el.addEventListener('keydown', e => { if (e.key === 'Escape') el.remove(); });
}

// ---------- Навигация стрелками (пульт телевизора) ----------
function spatialNav() {
  const SEL = 'a[href], button:not([disabled]), input, textarea, [tabindex="0"]';
  document.addEventListener('keydown', e => {
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (!dir) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && dir[1] === 0 && a.type !== 'radio'))) return;
    if (a && a.closest('.stars') && dir[1] === 0) return;
    const from = a && a !== document.body ? a.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
    let best = null, bestD = Infinity;
    for (const el of document.querySelectorAll(SEL)) {
      if (el === a || el.offsetParent === null || el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 4) continue;
      const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
      const d = along + across * 2.5;
      if (d < bestD) { bestD = d; best = el; }
    }
    if (best) { e.preventDefault(); best.focus({ preventScroll: false }); best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
  });
}

export function stars(v, size = '') {
  const full = Math.round((v || 0) * 2) / 2;
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<i class="${full >= i ? 'on' : full >= i - 0.5 ? 'half' : ''}">${ICON.star}</i>`;
  return `<span class="stars-ro ${size}" aria-hidden="true">${s}</span>`;
}

// Крупный режим для телевизора: включается сам на больших экранах, можно переключить вручную.
function tvMode() {
  let pref = null; try { pref = localStorage.getItem('ulika.tv'); } catch (e) { /* ignore */ }
  const ua = /SmartTV|SMART-TV|Tizen|Web0S|webOS|HbbTV|BRAVIA|AFT|Android TV|GoogleTV/i.test(navigator.userAgent);
  const on = pref === null ? ua : pref === '1';
  const btn = document.querySelector('[data-tv]');
  const apply = v => { document.documentElement.classList.toggle('tv', v); btn.setAttribute('aria-pressed', String(v)); };
  apply(on);
  btn.addEventListener('click', () => { const v = !document.documentElement.classList.contains('tv'); apply(v); try { localStorage.setItem('ulika.tv', v ? '1' : '0'); } catch (e) { /* ignore */ } });
}
