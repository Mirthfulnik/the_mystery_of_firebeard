// Главная: витрина, подборки, поиск и фильтр по темам.
import { GAMES, THEMES, COLLECTIONS, playersLabel } from './data.js';
import { stats } from './api.js';
import { frame, esc, num, plural, ICON, stars, share } from './ui.js';

frame('all');

const params = new URLSearchParams(location.search);
const state = { q: (params.get('q') || '').trim(), theme: params.get('theme') || '', coll: params.get('c') || '' };
let ST = {};

const norm = s => s.toLowerCase().replace(/ё/g, 'е');
function matches(g) {
  if (state.theme && !g.themes.includes(state.theme)) return false;
  const c = COLLECTIONS.find(x => x.id === state.coll);
  if (c) {
    if (c.theme && !g.themes.includes(c.theme)) return false;
    if (c.players && (g.players.max < c.players - 1 || g.players.min > c.players)) return false;
    if (c.tag && !(g.tags || []).includes(c.tag)) return false;
  }
  if (state.q) {
    const hay = norm([g.title, g.tagline, g.teaser, g.themes.join(' '), g.plot.join(' ')].join(' '));
    if (!norm(state.q).split(/\s+/).every(w => hay.includes(w))) return false;
  }
  return true;
}

function sync() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.theme) p.set('theme', state.theme);
  if (state.coll) p.set('c', state.coll);
  history.replaceState(null, '', (p.toString() ? '?' + p : location.pathname) + location.hash);
}

function score(s) {
  return s && s.rating ? `<span class="score" title="Средняя оценка">${s.rating.toFixed(1).replace('.', ',')}</span>` : '<span class="score none">Нет оценок</span>';
}

function card(g) {
  const s = ST[g.id] || {};
  return `<a class="card" href="game.html?id=${g.id}">
    <div class="poster"><img src="${g.poster}" alt="" loading="lazy" width="600" height="900">${score(s)}<span class="age" title="Возраст">${g.age}+</span></div>
    <h3>${esc(g.title)}</h3>
    <div class="meta">
      <span title="Игроки">${ICON.people}${playersLabel(g.players)}</span>
      <span title="Просмотры">${ICON.eye}${num(s.views || 0)}</span>
      <span title="Поделились">${ICON.share}${num(s.shares || 0)}</span>
    </div>
  </a>`;
}

function renderFeature() {
  const g = GAMES[0], s = ST[g.id] || {};
  document.getElementById('feature').innerHTML = `<article class="feature">
    <div class="feature-media" style="background-image:url('${g.cover}')">
      <video src="${g.trailer}" poster="${g.cover}" muted loop playsinline preload="none" aria-label="Трейлер игры"></video>
      <span class="label">Новинка</span>
    </div>
    <div class="feature-body">
      <div class="meta"><span class="age">${g.age}+</span><span>${ICON.people}${playersLabel(g.players)}</span><span>${ICON.clock}${g.duration}</span></div>
      <h1>${esc(g.title)}</h1>
      <p class="teaser">${esc(g.teaser)}</p>
      <div class="meta">
        <span class="rating">${stars(s.rating)} ${s.rating ? s.rating.toFixed(1).replace('.', ',') : '—'}</span>
        <span>${s.votes || 0} ${plural(s.votes || 0, 'оценка', 'оценки', 'оценок')}</span>
        <span>${ICON.eye}${num(s.views || 0)}</span><span>${ICON.share}${num(s.shares || 0)}</span>
      </div>
      <div class="row">
        <a class="btn big" href="game.html?id=${g.id}">Подробнее</a>
        <a class="btn ghost big" href="${g.playUrl}">${ICON.play}Играть</a>
        <button class="btn ghost big" data-share>${ICON.share}Поделиться</button>
      </div>
    </div>
  </article>`;
  const v = document.querySelector('.feature-media video');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }, { threshold: .4 }).observe(v);
  }
  document.querySelector('[data-share]').addEventListener('click', () => share(g, refresh));
}

function renderFilters() {
  const chip = (t, v) => `<button class="chip" data-theme="${esc(v)}" aria-pressed="${state.theme === v}">${esc(t)}</button>`;
  document.getElementById('themes').innerHTML = chip('Все темы', '') + THEMES.map(t => chip(t, t)).join('');
  document.getElementById('colls').innerHTML = COLLECTIONS.map(c => {
    const n = GAMES.filter(g => (!c.theme || g.themes.includes(c.theme)) && (!c.players || (g.players.max >= c.players - 1 && g.players.min <= c.players)) && (!c.tag || (g.tags || []).includes(c.tag))).length;
    return `<button class="coll" data-coll="${c.id}" aria-pressed="${state.coll === c.id}"><b>${esc(c.title)}</b><span>${esc(c.text)} · ${n} ${plural(n, 'игра', 'игры', 'игр')}</span></button>`;
  }).join('');
}

function renderGrid() {
  const list = GAMES.filter(matches);
  const grid = document.getElementById('grid');
  const filtered = state.q || state.theme || state.coll;
  document.getElementById('count').textContent = filtered ? `найдено: ${list.length}` : `${GAMES.length}`;
  if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Ничего не нашлось${state.q ? ` по запросу «${esc(state.q)}»` : ''}. <button class="chip" data-reset>Сбросить фильтры</button></div>`;
    return;
  }
  grid.innerHTML = list.map(card).join('') + (filtered ? '' : '<div class="soon"><b>Скоро</b><span>Новые расследования уже пишутся</span></div>');
}

function renderAll() { renderFilters(); renderGrid(); }

async function refresh() {
  ST = await stats(GAMES.map(g => g.id));
  renderFeature(); renderGrid();
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-theme]');
  if (t) { state.theme = t.dataset.theme; sync(); renderAll(); return; }
  const c = e.target.closest('[data-coll]');
  if (c) { state.coll = state.coll === c.dataset.coll ? '' : c.dataset.coll; sync(); renderAll(); document.getElementById('all').scrollIntoView({ behavior: 'smooth' }); return; }
  if (e.target.closest('[data-reset]')) { state.q = state.theme = state.coll = ''; document.getElementById('q').value = ''; sync(); renderAll(); }
});

// Живой поиск без перезагрузки
const q = document.getElementById('q');
q.addEventListener('input', () => { state.q = q.value.trim(); sync(); renderGrid(); });
q.closest('form').addEventListener('submit', e => { e.preventDefault(); state.q = q.value.trim(); sync(); renderGrid(); document.getElementById('all').scrollIntoView({ behavior: 'smooth' }); });

renderFeature();
renderAll();
refresh();
if (state.q || state.theme || state.coll) document.getElementById('all').scrollIntoView();
