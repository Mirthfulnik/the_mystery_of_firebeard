// Экран ТВ: сцена слева, текст справа. Хранит игру и раздаёт телефонам их части.
/* global qrcode */
import * as G from './game.js';
import { ROLES, ROLE_IDS, CAST, PROLOGUE, ZONES, ROUNDS, MIDNIGHT, DECISIONS, EPILOGUE, GUILTY } from './content.js';
import { Channel, probeBroker, randomToken, queryKeep } from './net.js';
import { GameAudio } from './audio.js';
import './pwa.js'; // офлайн-кэш установленного приложения

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const IMG = id => {
  if (!id) return '';
  if (id.startsWith('BG-') || id.startsWith('UI-')) return `img/bg/${id}.webp`;
  if (id.startsWith('CH-')) return `img/ch/${id}.webp`;
  if (id.startsWith('SC-')) return `img/sc/${id}.webp`;
  return `img/ev/${id}.webp`;
};
const FACE = role => `img/face/${ROLES[role].portrait}.webp`;
const SAVE_KEY = 'ognebord.host.v2';
const ONLINE_MS = 14000;
const fmt = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const audio = new GameAudio();
let state = null;
let ch = null;
let netStatus = 'off';
const seen = new Map();       // key -> lastSeen
let revealShowing = null;
let tickWarned = false;
let lastZones = 0;

// ---------- Сохранение ----------
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s && s.v === 2 && Date.now() - s.created < 1000 * 60 * 60 * 14) return s;
  } catch (e) { /* ignore */ }
  return null;
}

// ---------- Связь ----------
const online = key => Date.now() - (seen.get(key) || 0) < ONLINE_MS;

function startNet() {
  if (ch) ch.close();
  ch = new Channel({
    room: state.code, secret: state.secret, broker: state.broker, mine: 'host',
    onStatus: s => { netStatus = s; renderTop(); },
    onMsg,
    onConnect: () => broadcast(true),
  });
}

function sendView(key) {
  if (!ch) return;
  if (G.isGM(state, key)) ch.toClient(key, { t: 'view', v: G.viewForGM(state, online) });
  else ch.toClient(key, { t: 'view', v: G.viewFor(state, key) });
}

function broadcast() {
  if (!ch) return;
  for (const p of state.players) if (online(p.key)) sendView(p.key);
  if (state.gmKey && online(state.gmKey)) sendView(state.gmKey);
}

function onMsg(m) {
  const key = String(m.key || '').slice(0, 48);
  if (!key) return;
  const wasOnline = online(key);
  seen.set(key, Date.now());
  const isGm = G.isGM(state, key);
  const player = state.players.find(p => p.key === key);

  switch (m.t) {
    case 'hello': {
      if (m.gm) {
        if (m.gm !== state.gmToken) { ch.toClient(key, { t: 'denied' }); return; }
        if (state.gmKey !== key) { state.gmKey = key; toast('Ведущий подключился'); audio.sfx('SFX-20'); changed(); }
        else sendView(key);
        return;
      }
      if (player) { if (m.name && state.step === 0) player.name = String(m.name).slice(0, 20); sendView(key); if (!wasOnline) render(); return; }
      const r = G.addPlayer(state, key, m.name);
      if (r.ok) { audio.sfx('SFX-20'); changed(); return; }
      if (r.reason === 'started') {
        const free = state.players.filter(p => !online(p.key)).map(p => ({ key: p.key, name: p.name }));
        ch.toClient(key, { t: 'seats', seats: free });
      } else ch.toClient(key, { t: 'full' });
      return;
    }
    case 'ping':
      if (player || isGm) { if (m.rev !== state.rev) sendView(key); if (!wasOnline) { renderTop(); if (isGm) broadcast(); } }
      else if (state.step > 0) ch.toClient(key, { t: 'hello?' });
      return;
    case 'reclaim': {
      const target = state.players.find(p => p.key === m.seat);
      if (!target || online(target.key)) { ch.toClient(key, { t: 'seats', seats: [] }); return; }
      const p = G.reclaimSeat(state, m.seat, key);
      if (p) { toast(`${p.name} снова на борту`); changed(); }
      return;
    }
    case 'decide': {
      const r = G.decide(state, key, m.d, m.yes);
      if (r.ok) {
        if (r.reveal) showReveal(r.reveal);
        if (m.d === 'D5' && m.yes) audio.sfx('SFX-16', { gain: 0.5, delay: 6 });
        changed();
      }
      return;
    }
    case 'vote':
      if (G.castVote(state, key, m.vote)) { audio.sfx('SFX-19'); changed(); }
      return;
    case 'told':
      if (G.markTold(state, key)) changed();
      return;
    case 'ctl':
      if (isGm) control(m.a, m.arg);
      return;
    default:
  }
}

function control(a, arg) {
  switch (a) {
    case 'next': advance(1); break;
    case 'prev': advance(-1); break;
    case 'pause': G.timerPause(state); changed(); break;
    case 'plus': G.timerAdd(state, 60); tickWarned = false; changed(); break;
    case 'speaker': G.nextSpeaker(state); changed(); break;
    case 'kick': if (G.removePlayer(state, arg)) { ch.toClient(arg, { t: 'kicked' }); changed(); } break;
    case 'replay': if (DECISIONS[arg] && state.decisions[arg]) showReveal(arg); break;
    case 'close': closeReveal(); break;
    default:
  }
}

function changed() {
  state.rev++;
  save();
  const z = state.step > 0 ? G.zonesOpen(state).length : 0;
  if (z > lastZones && state.step > 0) audio.sfx('SFX-22', { delay: 1 });
  lastZones = z;
  broadcast();
  render();
}

// ---------- Ход игры ----------
function advance(d) {
  if (revealShowing) { closeReveal(); if (d > 0) return; }
  if (!G.go(state, d)) return;
  tickWarned = false;
  cue();
  changed();
}

function cue() {
  const s = G.cur(state);
  const M = id => audio.music(id);
  switch (s.id) {
    case 'lobby': case 'roles': case 'cast': M('MU-01'); break;
    case 'prologue':
      if (s.i === 2) {
        M(null);
        audio.sfx('SFX-08', { count: 3 });
        audio.sfx('SFX-04', { delay: 1.5, gain: 0.7 });
        audio.sfx('SFX-01', { delay: 3.4, variant: 'choke' });
        audio.sfx('SFX-06', { delay: 5.4 });
        audio.sfx('SFX-02', { delay: 6.2 });
        audio.sfx('SFX-03', { delay: 6.8 });
        setTimeout(() => { if (G.cur(state).id === 'prologue') M('MU-02'); }, 8500);
      } else { if (s.i === 3) audio.sfx('SFX-06', { gain: 0.6 }); M('MU-02'); }
      break;
    case 'inspect': M('MU-03'); break;
    case 'r-intro':
      if (s.r === 3) {
        M('MU-05');
        audio.sfx('SFX-04', { gain: 0.8 });
        audio.sfx('SFX-01', { delay: 1.2 });
        audio.sfx('SFX-02', { delay: 4.2 });
        audio.sfx('SFX-03', { delay: 4.8 });
        audio.sfx('SFX-05', { delay: 6.5 });
      } else {
        M('MU-02');
        if (s.r === 1) audio.sfx('SFX-07', { gain: 0.8 });
        if (s.r === 2) audio.sfx('SFX-10', { delay: 2 });
        if (s.r === 4) audio.sfx('SFX-11', { delay: 1 });
        if (s.r === 5) audio.sfx('SFX-09', { delay: 0.8 });
      }
      break;
    case 'r-cards': M('MU-03'); break;
    case 'r-discuss': case 'm-discuss': M('MU-04'); break;
    case 'm-intro': M('MU-06'); audio.sfx('SFX-08', { delay: 0.5 }); break;
    case 'm-cards': M('MU-06'); break;
    case 'vote': case 'votes': M('MU-07'); break;
    case 'verdict': {
      const res = G.results(state);
      M(res.solved ? 'MU-08' : 'MU-09');
      if (!res.solved) audio.sfx('SFX-01', { delay: 0.6, variant: 'far' });
      break;
    }
    case 'epi': M('MU-02'); break;
    case 'scores': M('MU-01'); break;
    default:
  }
}

// ---------- Открытие улик ----------
function showReveal(d) {
  revealShowing = d;
  const R = DECISIONS[d].reveal;
  if (R.sfx) audio.sfx(R.sfx, R.tape ? { verb: 0.1 } : {});
  render();
  clearTimeout(showReveal.t);
  showReveal.t = setTimeout(closeReveal, R.tape ? 20000 : 15000);
}
function closeReveal() { if (!revealShowing) return; revealShowing = null; render(); }

function revealHTML(d) {
  const R = DECISIONS[d].reveal;
  const imgs = R.imgs.map(id => id === 'BADGE'
    ? `<div class="badge-wrap"><img src="${IMG(id)}" alt="Удостоверение"><div class="badge-text">«Нептун»<br>Бернард Гримм<br>следователь</div></div>`
    : `<img src="${IMG(id)}" alt="" class="${id === 'PHOTO' ? 'photo' : ''}">`).join('');
  return `<div class="reveal" role="dialog" aria-label="${esc(R.title)}"><div class="imgs">${imgs}</div>
    <div class="card parch"><h2>${esc(R.title)}</h2><p>${esc(R.text)}</p>${R.tape ? '<div class="stamp">23:42</div>' : ''}</div></div>`;
}

function boardHTML() {
  const items = Object.entries(DECISIONS).filter(([d, D]) => state.decisions[d] === true && D.reveal).map(([d, D]) => {
    const im = D.reveal.imgs[D.reveal.imgs.length > 1 ? 1 : 0];
    return `<button class="ev" data-replay="${d}" title="Показать ещё раз"><img src="${IMG(im)}" alt="">${esc(D.reveal.short)}</button>`;
  });
  return items.length ? `<div class="board">${items.join('')}</div>` : '';
}

// ---------- Ссылки и QR ----------
function base() { return new URL('.', location.href).href; }
function playerURL() { return `${base()}play.html${queryKeep()}#r=${state.code}&s=${state.secret}&b=${state.broker}`; }
function gmURL() { return `${base()}gm.html${queryKeep()}#r=${state.code}&s=${state.secret}&g=${state.gmToken}&b=${state.broker}`; }
function qrSVG(text) { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); }

// ---------- Отрисовка ----------
let bgCur = null;
function setScene(id, dim = false) {
  const key = (id || '') + (dim ? '|d' : '');
  if (key === bgCur) return;
  bgCur = key;
  const url = id ? IMG(id) : '';
  for (const [sel, cls] of [['#blur', 'blurbg'], ['#scene', 'sceneimg']]) {
    const host = $(sel);
    const old = [...host.children];
    const el = document.createElement('div');
    el.className = cls + (dim ? ' dim' : '');
    if (url) el.style.backgroundImage = `url("${url}")`;
    host.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    setTimeout(() => old.forEach(o => o.remove()), 1400);
  }
}

function renderTop() {
  const el = $('#top');
  if (!state) { el.innerHTML = ''; return; }
  const labels = { connecting: 'подключение…', online: 'на связи', reconnecting: 'переподключение…', error: 'нет связи', off: '' };
  const n = state.players.filter(p => online(p.key)).length;
  el.innerHTML = `<span class="net ${netStatus === 'online' ? 'online' : ''}"><i></i>${labels[netStatus] || ''}</span>
    <span>Игроков на связи: ${n} из ${state.players.length}</span>
    <span>${state.gmKey && online(state.gmKey) ? 'Ведущий с телефоном' : 'Ведущий — у этого экрана'}</span>`;
}

function panelHTML(N, extra = '') {
  const body = N.list ? `<ul>${N.list.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : (N.text ? `<p>${esc(N.text)}</p>` : '');
  return `${N.kicker ? `<div class="kicker">${esc(N.kicker)}</div>` : ''}
    ${N.title ? `<h1 class="${N.big ? 'big' : ''}">${esc(N.title)}</h1>` : ''}
    <div class="body ${N.big ? 'big' : ''}">${body}</div>
    ${N.hint ? `<p class="hint">${esc(N.hint)}</p>` : ''}${extra}`;
}

function leftHTML() {
  const s = G.cur(state);
  switch (s.id) {
    case 'lobby': {
      const seats = state.players.map(p => `<li><span class="dot ${online(p.key) ? 'on' : ''}"></span>${esc(p.name)}<button class="x" data-kick="${esc(p.key)}" aria-label="Убрать ${esc(p.name)}">✕</button></li>`).join('');
      return `<div class="lobby"><div class="ring"><div class="qr">${qrSVG(playerURL())}</div></div>
        <div class="seats-wrap"><h2>Игроки</h2><ul class="seats">${seats || '<li class="empty">Пока никого — сканируйте код</li>'}</ul></div></div>`;
    }
    case 'cast': {
      const portrait = s.i < CAST.length ? CAST[s.i].portrait : ROLES[ROLE_IDS[s.i - CAST.length]].portrait;
      return `<div class="hero" style="background-image:url('${IMG(portrait)}')"></div>`;
    }
    case 'inspect': return zonesHTML();
    case 'm-discuss': return zonesHTML() + boardHTML();
    case 'r-cards': {
      const order = G.speakingOrder(state);
      return `<div class="speakers">${order.map((sp, i) => `<div class="sp ${i === state.speaker ? 'now' : i < state.speaker ? 'done' : ''}">
        <img src="${FACE(sp.role)}" alt=""><div class="nm">${esc(sp.key ? sp.name : 'Ведущий')}</div><div class="rl">${esc(ROLES[sp.role].name)}</div></div>`).join('')}</div>${boardHTML()}`;
    }
    case 'r-discuss': case 'm-cards': return boardHTML();
    case 'vote': case 'votes': {
      const res = s.id === 'votes' ? G.results(state) : null;
      const max = res ? Math.max(...Object.values(res.tally)) : 0;
      return `<div class="barrels">${ROLE_IDS.map(r => {
        const p = G.owner(state, r);
        const voted = p && state.votes[p.key];
        return `<div class="barrel ${res && res.tally[r] === max && max > 0 ? 'lead' : ''}"><img src="${FACE(r)}" alt=""><div class="nm">${esc(ROLES[r].name)}</div><div class="rl">${esc(p ? p.name : 'ведущий')}</div>
          ${res ? `<div class="cnt">${res.tally[r]}</div>` : `<div class="mark">${voted ? '✓ голос' : p ? '' : ''}</div>`}</div>`;
      }).join('')}</div>`;
    }
    case 'epi': { const E = EPILOGUE[s.i]; return E.portrait ? `<div class="hero" style="background-image:url('${IMG(E.portrait)}')"></div>` : ''; }
    case 'scores': {
      const res = G.results(state);
      return `<div class="scores parch"><table>${res.scores.map((sc, i) => `<tr class="${res.winners.includes(sc.key) ? 'win' : ''}">
        <td class="place">${i + 1}</td><td><img class="av" src="${FACE(sc.role)}" alt=""></td>
        <td><div class="pl">${esc(sc.name)}</div><div class="rl">${esc(ROLES[sc.role].name)}</div></td>
        <td class="lines">${sc.lines.map(l => `${esc(l.label)}: ${l.pts > 0 ? '+' : ''}${l.pts}`).join('<br>') || 'Очков нет'}</td>
        <td class="tot">${sc.total}</td></tr>`).join('')}</table></div>`;
    }
    default: return '';
  }
}

function zonesHTML() {
  const open = G.zonesOpen(state);
  const unl = { prologue: 'открыта', round2: 'в раунде 2', round4: 'в раунде 4', midnight: 'в полночь' };
  const focus = G.cur(state).zone;
  return `<div class="zones">${ZONES.map(z => {
    const o = open.includes(z.id);
    const img = state.decisions.D5 === true && z.imgNoJar ? z.imgNoJar : z.img;
    return `<div class="zone ${o ? '' : 'locked'} ${z.id === focus ? 'focus' : ''}"><div class="im" style="background-image:url('${IMG(img)}')"></div><div class="nm">${esc(z.name)}</div><div class="st">${o ? 'можно осматривать' : unl[z.unlock]}</div></div>`;
  }).join('')}</div>`;
}

function sceneFor(s = G.cur(state)) {
  switch (s.id) {
    case 'lobby': return ['UI-02', true];
    case 'roles': return ['UI-02', false];
    case 'cast': return ['BG-02', true];
    case 'prologue': return [PROLOGUE[s.i].bg, false];
    case 'inspect': return s.zone ? (s.m ? ['BG-07', true] : [ROUNDS[s.r - 1].bg, true]) : ['BG-07', true];
    case 'r-intro': return [ROUNDS[s.r - 1].bg, false];
    case 'r-cards': case 'r-discuss': return [ROUNDS[s.r - 1].bg, true];
    case 'm-intro': return ['BG-07', false];
    case 'm-cards': return ['BG-07', true];
    case 'm-discuss': case 'vote': case 'votes': return ['BG-01', true];
    case 'verdict': return [G.results(state).solved ? 'UI-08' : 'UI-09', false];
    case 'epi': return [EPILOGUE[s.i].bg, !!EPILOGUE[s.i].portrait];
    case 'scores': return [G.results(state).solved ? 'UI-08' : 'UI-09', true];
    default: return ['UI-02', true];
  }
}

function panelExtra() {
  const s = G.cur(state);
  if (s.id === 'lobby') {
    const gmOk = state.gmKey && online(state.gmKey);
    return `<div class="gmbox">${gmOk ? '<b>Ведущий подключён.</b> Листайте игру с его телефона.'
      : `<div class="gmqr">${qrSVG(gmURL())}</div><div><b>Код для ведущего</b><br>Ведущий сканирует его своим телефоном и получает пульт и все тексты. Без него игру можно листать с этого экрана.</div>`}</div>
      <button class="btn" data-act="next" ${state.players.length ? '' : 'disabled'}>Начать: раздать роли</button>`;
  }
  if (s.id === 'r-cards' && G.currentSpeaker(state)) return '<button class="btn ghost" data-act="speaker">Следующий рассказчик</button>';
  if (s.id === 'scores') return '<button class="btn ghost" data-act="newgame">Новая игра</button>';
  return '';
}

let lastHTML = '';
function render() {
  if (!state) return;
  renderTop();
  const [bg, dim] = sceneFor();
  setScene(bg, dim);
  const left = leftHTML();
  const panel = panelHTML(G.narrative(state), panelExtra());
  const html = `<div class="left">${left}</div><aside class="panel">${panel}<div class="clock" id="clock" hidden></div></aside>` + (revealShowing ? revealHTML(revealShowing) : '');
  if (html !== lastHTML) { $('#screen').innerHTML = html; lastHTML = html; }
  preloadAhead();
  fitPanel();
  renderDock();
  renderClock();
}

// Длинный текст уменьшается, чтобы целиком влезть в панель
function fitPanel() {
  const p = document.querySelector('.panel');
  const body = p && p.querySelector('.body');
  if (!body) return;
  let s = 1;
  body.style.fontSize = '';
  while (p.scrollHeight > p.clientHeight + 1 && s > 0.62) { s -= 0.04; body.style.fontSize = (2.75 * s) + 'vh'; }
}

function renderDock() {
  const t = state.timer;
  const s = G.cur(state);
  $('#dock').innerHTML = `
    <button class="btn ghost" data-act="prev" ${G.canBack(state) ? '' : 'disabled'}>Назад</button>
    <span class="where">${esc(G.stepLabel(state))}</span>
    <div class="progress" aria-hidden="true"><i style="width:${(state.step / (G.steps().length - 1)) * 100}%"></i></div>
    ${t ? `<button class="icon" data-act="pause" title="Пауза (P)" aria-label="Пауза таймера">${t.endsAt ? '❚❚' : '▶'}</button><button class="btn ghost" data-act="plus">+1 мин</button>` : ''}
    <button class="icon" data-act="mute" aria-pressed="${audio.muted}" title="Звук (M)" aria-label="Выключить звук">♪</button>
    <button class="icon" data-act="fs" title="Во весь экран (F)" aria-label="Во весь экран">⛶</button>
    ${s.id === 'lobby' ? '' : `<button class="btn" data-act="next" ${G.canAdvance(state) ? '' : 'disabled'}>Далее</button>`}`;
}

function renderClock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const t = state && state.timer;
  if (!t) { el.hidden = true; return; }
  el.hidden = false;
  const left = G.timerLeft(t);
  el.className = 'clock' + (t.endsAt ? '' : ' paused') + (left < 30000 && left > 0 ? ' low' : '');
  el.innerHTML = `<div class="t">${fmt(left)}</div><div class="l">${t.endsAt ? (left > 0 ? 'осталось' : 'время вышло') : 'пауза'}</div>`;
  if (t.endsAt && left <= 10500 && left > 9000 && !tickWarned) { tickWarned = true; audio.sfx('SFX-21', { gain: 0.6 }); }
}

let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- Предзагрузка картинок ----------
const loaded = new Set();
const queue = [];
let busy = 0;
function want(url, front = false) {
  if (!url || loaded.has(url) || queue.includes(url)) return;
  front ? queue.unshift(url) : queue.push(url);
  pump();
}
function pump() {
  while (busy < 2 && queue.length) {
    const url = queue.shift();
    if (loaded.has(url)) continue;
    busy++;
    const im = new Image();
    im.decoding = 'async';
    im.onload = im.onerror = () => { loaded.add(url); busy--; setTimeout(pump, 30); };
    im.src = url;
  }
}
function imagesAt(i) {
  const s = G.steps()[i];
  if (!s) return [];
  const out = [];
  const sc = sceneFor(s);
  if (sc[0] && !(s.id === 'verdict' || s.id === 'scores')) out.push(IMG(sc[0]));
  if (s.id === 'votes') out.push(IMG('UI-08'), IMG('UI-09'));
  if (s.id === 'cast') out.push(IMG(s.i < CAST.length ? CAST[s.i].portrait : ROLES[ROLE_IDS[s.i - CAST.length]].portrait));
  if (s.id === 'epi' && EPILOGUE[s.i].portrait) out.push(IMG(EPILOGUE[s.i].portrait));
  if (s.id === 'inspect' || s.id === 'm-discuss') ZONES.forEach(z => { out.push(IMG(z.img)); if (z.imgNoJar) out.push(IMG(z.imgNoJar)); });
  if (s.id === 'r-cards' || s.id === 'vote' || s.id === 'scores') ROLE_IDS.forEach(r => out.push(FACE(r)));
  if (s.id === 'r-cards' && s.r >= 4) Object.values(DECISIONS).forEach(D => D.reveal && D.reveal.imgs.forEach(x => out.push(IMG(x))));
  return out;
}
// следующие два шага — в первую очередь, остальное — фоном по порядку
function preloadAhead() {
  if (!state) return;
  for (let k = 2; k >= 1; k--) imagesAt(state.step + k).reverse().forEach(u => want(u, true));
  if (!preloadAhead.all) { preloadAhead.all = true; G.steps().forEach((_, i) => imagesAt(i).forEach(u => want(u))); }
}

// ---------- Звуковая заставка ----------
function intro() {
  audio.unlock();
  audio.sfx('SFX-07', { gain: 0.9 });
  audio.sfx('SFX-04', { delay: 0.6, gain: 0.5 });
  audio.sfx('SFX-20', { delay: 1.0 });
  audio.sfx('SFX-20', { delay: 2.2, gain: 0.8 });
  audio.sfx('SFX-11', { delay: 3.2, gain: 0.6 });
  audio.sfx('SFX-01', { delay: 4.2 });
  setTimeout(() => audio.music('MU-01'), 6800);
}

function renderSplash() {
  document.body.classList.add('splashing');
  setScene('UI-02', true);
  $('#dock').innerHTML = '';
  $('#top').innerHTML = '';
  $('#screen').innerHTML = `<button class="splash" data-act="enter" autofocus>
    <span class="logo">Призрак<br>Огнеборода</span>
    <span class="tap">Нажмите, чтобы подняться на борт</span>
    <span class="sub">Включите звук на телевизоре</span></button>`;
  lastHTML = '';
  want(IMG('UI-02'), true);
}

// ---------- Титул ----------
function renderTitle(msg = '') {
  setScene('UI-02', false);
  const saved = loadSaved();
  $('#dock').innerHTML = '';
  $('#top').innerHTML = '';
  $('#screen').innerHTML = `<div class="left"><h1 class="logo">Призрак<br>Огнеборода<small>Детектив на одну хэллоуинскую ночь</small></h1></div>
    <aside class="panel"><div class="kicker">Для 1–5 игроков и ведущего</div><h1>Новая игра</h1>
    <div class="body"><p>Играть можно из любой сети: телефоны подключаются по QR-коду или по ссылке. В игре всегда все пять персонажей — свободные роли читает ведущий.</p></div>
    <button class="btn" data-act="start">Новая игра</button>
    ${saved && saved.step > 0 ? `<button class="btn ghost" data-act="resume">Продолжить игру ${saved.code}</button>` : ''}
    ${msg ? `<p class="hint">${esc(msg)}</p>` : ''}</aside>`;
  lastHTML = '';
}

async function startGame(resume) {
  audio.unlock();
  if (resume) state = loadSaved();
  if (!state) {
    renderTitle('Ищем свободный сервер связи…');
    const broker = await probeBroker(0);
    state = G.newState({ secret: randomToken(16), gmToken: randomToken(9), broker });
    try { window.ym && ym(113916917, 'reachGoal', 'game_start'); } catch (e) { /* ignore */ }
  }
  lastHTML = '';
  lastZones = state.step > 0 ? G.zonesOpen(state).length : 0;
  startNet();
  cue();
  save();
  render();
}

// ---------- События ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act],[data-kick],[data-replay]');
  if (!b) return;
  audio.unlock();
  if (b.dataset.kick) { control('kick', b.dataset.kick); return; }
  if (b.dataset.replay) { showReveal(b.dataset.replay); return; }
  switch (b.dataset.act) {
    case 'enter': document.body.classList.remove('splashing'); intro(); renderTitle(); break;
    case 'start': localStorage.removeItem(SAVE_KEY); state = null; startGame(false); break;
    case 'resume': startGame(true); break;
    case 'newgame':
      if (confirm('Начать новую игру? Текущая будет удалена.')) { localStorage.removeItem(SAVE_KEY); if (ch) ch.close(); state = null; audio.music(null); bgCur = null; renderTitle(); }
      break;
    case 'mute': audio.setMuted(!audio.muted); renderDock(); break;
    case 'fs': toggleFs(); break;
    default: control(b.dataset.act);
  }
});

document.addEventListener('keydown', e => {
  if (!state && document.querySelector('.splash') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); document.body.classList.remove('splashing'); intro(); renderTitle(); return; }
  if (!state || e.target.closest('input,textarea')) return;
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); advance(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') advance(-1);
  else if (e.key === 'Escape') closeReveal();
  else if (e.key === 'm' || e.key === 'ь') { audio.setMuted(!audio.muted); renderDock(); }
  else if (e.key === 'f' || e.key === 'а') toggleFs();
  else if ((e.key === 'p' || e.key === 'з') && state.timer) { G.timerPause(state); changed(); }
});

function toggleFs() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

setInterval(() => { if (state) renderClock(); }, 500);
setInterval(() => { if (state) { renderTop(); if (G.cur(state).id === 'lobby') render(); } }, 5000);
setInterval(() => { if (state && state.timer) broadcast(); }, 20000);

renderSplash();
window.__game = { get state() { return state; }, G, audio, online };
