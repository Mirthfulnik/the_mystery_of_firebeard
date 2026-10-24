// Экран ведущего (ТВ / ноутбук / планшет). Хранит игру и раздаёт телефонам их части.
/* global qrcode */
import * as G from './game.js';
import { ROLES, CAST, PROLOGUE, ZONES, ROUNDS, MIDNIGHT, DECISIONS, EPILOGUE, GUILTY } from './content.js';
import { HostNet, peerParam } from './net.js';
import { GameAudio } from './audio.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const IMG = id => {
  if (!id) return '';
  if (id.startsWith('BG-') || id.startsWith('UI-')) return `img/bg/${id}.webp`;
  if (id.startsWith('CH-')) return `img/ch/${id}.webp`;
  if (id.startsWith('SC-')) return `img/sc/${id}.webp`;
  return `img/ev/${id}.webp`;
};
const SAVE_KEY = 'ognebord.host.v1';
const fmt = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const audio = new GameAudio();
let state = null;
let net = null;
let netStatus = 'off';
const connKey = new Map();   // conn -> player key
const keyConn = new Map();   // key -> conn
let pendingCount = 4;
let revealShowing = null;
let lastRendered = '';
let tickWarned = false;

// ---------- Сохранение ----------
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* приватный режим */ }
}
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s && s.v === 1 && Date.now() - s.created < 1000 * 60 * 60 * 12) return s;
  } catch (e) { /* ignore */ }
  return null;
}

// ---------- Сеть ----------
function startNet() {
  if (net) net.destroy();
  net = new HostNet(state.code, {
    onStatus: (s, msg) => { netStatus = s; if (msg) toast(msg); renderTop(); },
    onJoin,
    onMsg,
    onClose: conn => {
      const k = connKey.get(conn);
      connKey.delete(conn);
      if (k && keyConn.get(k) === conn) keyConn.delete(k);
      render();
    },
  });
}

function onJoin(conn, msg) {
  const key = String(msg.key || '').slice(0, 40);
  if (!key) return;
  const known = state.players.find(p => p.key === key);
  if (!known && state.step > 0) {
    // игра уже идёт — предложить занять место отключившегося
    const free = state.players.filter(p => !isOnline(p.key)).map(p => ({ key: p.key, name: p.name }));
    net.send(conn, { t: 'seats', seats: free });
    return;
  }
  const r = G.addPlayer(state, key, msg.name);
  if (!r.ok) { net.send(conn, { t: 'full', reason: r.reason }); return; }
  bind(conn, key);
  if (!r.rejoined) audio.sfx('SFX-20');
  changed();
}

function bind(conn, key) {
  conn.lastSeen = Date.now();
  const old = keyConn.get(key);
  if (old && old !== conn) { connKey.delete(old); try { old.close(); } catch (e) { /* ignore */ } }
  connKey.set(conn, key);
  keyConn.set(key, conn);
}

function onMsg(conn, msg) {
  if (msg.t === 'reclaim') {
    const target = state.players.find(p => p.key === msg.seat);
    if (!target || isOnline(target.key)) { net.send(conn, { t: 'seats', seats: [] }); return; }
    const p = G.reclaimSeat(state, msg.seat, msg.key);
    if (p) { bind(conn, msg.key); toast(`${p.name} снова на борту`); changed(); }
    return;
  }
  const key = connKey.get(conn);
  if (!key) return;
  const me = state.players.find(p => p.key === key);
  switch (msg.t) {
    case 'decide': {
      const r = G.decide(state, key, msg.d, msg.yes);
      if (r.ok) {
        if (r.reveal) showReveal(r.reveal);
        if (msg.d === 'D5' && msg.yes) audio.sfx('SFX-16', { gain: 0.5, delay: 6 });
        const zonesBefore = (lastZones || []).length;
        if (G.zonesOpen(state).length > zonesBefore) audio.sfx('SFX-22', { delay: 1.5 });
        changed();
      }
      break;
    }
    case 'vote':
      if (G.castVote(state, key, msg.vote)) { audio.sfx('SFX-19'); changed(); }
      break;
    case 'told': {
      const cs = G.cur(state);
      if (cs.id !== 'r-cards') break;
      state.told[key] = true;
      const order = G.speakingOrder(state);
      if (order[state.speaker] && order[state.speaker].key === key) nextSpeaker();
      changed();
      break;
    }
    case 'next':
      if (isCaptain(key)) advance(1);
      break;
    case 'pause':
      if (isCaptain(key)) { G.timerPause(state); changed(); }
      break;
    case 'rename':
      if (me && state.step === 0) { me.name = String(msg.name || '').slice(0, 20) || me.name; changed(); }
      break;
    default:
  }
}

function isCaptain(key) { return state.players[0] && state.players[0].key === key; }
function isOnline(key) { const c = keyConn.get(key); return !!(c && c.open && Date.now() - (c.lastSeen || 0) < 13000); }

function broadcast() {
  for (const [key, conn] of keyConn) {
    net.send(conn, { t: 'view', v: G.viewFor(state, key) });
  }
}

let lastZones = [];
function changed() {
  save();
  broadcast();
  const z = state.step > 0 ? G.zonesOpen(state) : [];
  lastZones = z;
  render();
}

// ---------- Ход игры ----------
function advance(d) {
  if (revealShowing) { closeReveal(); if (d > 0) return; }
  const before = G.zonesOpen(state).length;
  if (!G.go(state, d)) return;
  tickWarned = false;
  if (d > 0 && G.zonesOpen(state).length > before) audio.sfx('SFX-22', { delay: 1 });
  cue();
  changed();
}

function nextSpeaker() {
  const order = G.speakingOrder(state);
  if (state.speaker < order.length) state.speaker++;
}

// Музыка и звуки для каждого шага
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
      } else if (s.i === 3) { audio.sfx('SFX-06', { gain: 0.6 }); M('MU-02'); } else M('MU-02');
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
        if (s.r === 2) audio.sfx('SFX-10', { delay: 2 });
        if (s.r === 4) audio.sfx('SFX-11', { delay: 1 });
        if (s.r === 5) audio.sfx('SFX-09', { delay: 0.8 });
        if (s.r === 1) audio.sfx('SFX-07', { gain: 0.8 });
      }
      break;
    case 'r-cards': M('MU-03'); break;
    case 'r-discuss': M('MU-04'); break;
    case 'm-intro': M('MU-06'); audio.sfx('SFX-08', { delay: 0.5 }); break;
    case 'm-cards': M('MU-06'); break;
    case 'm-discuss': M('MU-04'); break;
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
  const D = DECISIONS[d];
  if (D.reveal.sfx) audio.sfx(D.reveal.sfx, D.reveal.tape ? { verb: 0.1 } : {});
  render();
  clearTimeout(showReveal.t);
  showReveal.t = setTimeout(closeReveal, D.reveal.tape ? 20000 : 15000);
}
function closeReveal() { revealShowing = null; render(); }

function revealHTML(d) {
  const R = DECISIONS[d].reveal;
  const imgs = R.imgs.map(id => {
    if (id === 'BADGE') return `<div class="badge-wrap"><img src="${IMG(id)}" alt="Удостоверение"><div class="badge-text">«Нептун»<br>Бернард Гримм<br>следователь</div></div>`;
    return `<img src="${IMG(id)}" alt="" class="${id === 'PHOTO' ? 'photo' : ''}">`;
  }).join('');
  return `<div class="reveal" role="dialog" aria-label="${esc(R.title)}">
    <div class="imgs">${imgs}</div>
    <div class="card parch"><h2>${esc(R.title)}</h2><p>${esc(R.text)}</p>
    ${R.tape ? '<div class="stamp">23:42</div>' : ''}</div></div>`;
}

function boardHTML() {
  const items = [];
  for (const [d, D] of Object.entries(DECISIONS)) {
    if (state.decisions[d] === true && D.reveal) {
      const im = D.reveal.imgs[D.reveal.imgs.length > 1 ? 1 : 0];
      items.push(`<button class="ev" data-replay="${d}" style="background:none;border:0;cursor:pointer;color:inherit" title="Показать ещё раз"><img src="${IMG(im)}" alt="">${esc(D.reveal.short)}</button>`);
    }
  }
  return items.length ? `<div class="board">${items.join('')}</div>` : '';
}

// ---------- Отрисовка ----------
let bgCurrent = null;
function setBg(id, dim = false) {
  const url = id ? IMG(id) : null;
  const key = (url || '') + (dim ? '|d' : '');
  if (key === bgCurrent) return;
  bgCurrent = key;
  const old = [...document.querySelectorAll('.bg')];
  const el = document.createElement('div');
  el.className = 'bg' + (dim ? ' dim' : '');
  if (url) el.style.backgroundImage = `url("${url}")`;
  $('#bgs').appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  setTimeout(() => old.forEach(o => o.remove()), 1400);
}

function playerURL() {
  const base = new URL('.', location.href);
  return `${base.href}play.html?room=${state.code}${peerParam()}`;
}

function qrSVG(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}

function renderTop() {
  const labels = { connecting: 'подключение…', online: 'на связи', reconnecting: 'переподключение…', busy: 'ждём код комнаты…', error: 'нет связи', off: '' };
  const cls = netStatus === 'online' ? 'online' : netStatus === 'error' ? 'error' : '';
  const el = $('#top');
  if (!state) { el.innerHTML = ''; return; }
  const online = state.players.filter(p => isOnline(p.key)).length;
  el.innerHTML = `<span class="room">Комната <b>${state.code}</b></span>
    <span class="net ${cls}"><i></i>${labels[netStatus] || netStatus}</span>
    <span>${online} из ${state.count} телефонов</span>
    <span class="spacer"></span>`;
}

function personHTML(p, cls = '', extra = '') {
  const R = ROLES[p.role];
  return `<div class="person ${cls}"><div class="ph" style="background-image:url('${IMG(R.portrait)}')"></div>
    <div class="nm">${esc(p.name)}</div><div class="rl">${esc(R.name)}</div>${extra}</div>`;
}

function screenHTML() {
  const s = G.cur(state);
  const all = G.steps(state);
  switch (s.id) {
    case 'lobby': {
      setBg('UI-02', true);
      const url = playerURL();
      const seats = [];
      for (let i = 0; i < state.count; i++) {
        const p = state.players[i];
        seats.push(p
          ? `<li class="filled"><span class="dot ${isOnline(p.key) ? 'on' : ''}"></span>${esc(p.name)}${i === 0 ? ' <small style="color:var(--muted);font-size:1.8vh">— пульт</small>' : ''}<button class="x" data-kick="${esc(p.key)}" aria-label="Убрать ${esc(p.name)}">✕</button></li>`
          : `<li class="empty"><span class="dot"></span>свободное место</li>`);
      }
      return `<div class="screen lobby">
        <div class="ring"><div class="qr">${qrSVG(url)}</div></div>
        <div><h2>Поднимайтесь на борт</h2>
        <div class="url">Наведите камеру телефона на код или откройте<br>${esc(url.replace(/^https?:\/\//, '').split('?')[0])} и введите комнату <b>${state.code}</b></div>
        <ul class="seats">${seats.join('')}</ul>
        <button class="btn" data-act="next" ${state.players.length === state.count ? '' : 'disabled'}>Раздать роли</button>
        <p class="hint">Первый подключившийся телефон станет пультом: с него можно листать игру.</p></div></div>`;
    }
    case 'roles':
      setBg('UI-02', true);
      return `<div class="screen center"><h1 class="big-title">Роли розданы</h1>
        <p class="sub">Посмотрите в телефон, кем вы будете этой ночью. Никому не показывайте экран.</p></div>`;
    case 'cast': {
      setBg('BG-02', true);
      const inGame = G.rolesInGame(state);
      if (s.i < CAST.length) {
        const c = CAST[s.i];
        return `<div class="screen cast"><div class="portrait" style="background-image:url('${IMG(c.portrait)}')"></div>
          <div class="info"><div class="tag">${esc(c.tag)}</div><h1>${esc(c.name)}</h1><div class="parch">${esc(c.text)}</div></div></div>`;
      }
      const role = inGame[s.i - CAST.length];
      const R = ROLES[role];
      const p = G.playerByRole(state, role);
      return `<div class="screen cast"><div class="portrait" style="background-image:url('${IMG(R.portrait)}')"></div>
        <div class="info"><div class="tag">${R.key ? 'Главная роль' : 'Дополнительная роль'}</div><h1>${esc(R.name)}</h1>
        <div class="who">Играет ${esc(p ? p.name : '')}: прочитайте описание вслух</div>
        <div class="parch">${esc(R.desc)}</div></div></div>`;
    }
    case 'prologue': {
      const P = PROLOGUE[s.i];
      setBg(P.bg);
      if (P.big) return `<div class="screen"><div class="scroll parch big">${esc(P.text)}</div></div>`;
      const body = P.list ? `<h3>${esc(P.title)}</h3><ul>${P.list.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : `<p>${esc(P.text)}</p>`;
      return `<div class="screen"><div class="scroll parch">${body}</div></div>`;
    }
    case 'inspect':
      setBg('BG-07', true);
      return `<div class="screen center"><h1 class="big-title">Осмотр места преступления</h1>
        <p class="sub">Откройте вкладку «Осмотр» в телефоне и нажимайте на предметы. Новые места откроются по ходу вечера.</p>
        ${zonesHTML()}</div>`;
    case 'r-intro': {
      const R = ROUNDS[s.r - 1];
      setBg(R.bg);
      return `<div class="screen"><div class="round-head"><div class="n">Раунд ${R.n} из 5</div><h1>${esc(R.title)}</h1><div class="time">${R.time}</div></div>
        <div class="scroll parch"><p>${esc(R.intro)}</p></div></div>`;
    }
    case 'r-cards': {
      const R = ROUNDS[s.r - 1];
      setBg(R.bg, true);
      const order = G.speakingOrder(state);
      const people = order.map((p, i) => personHTML(p, i === state.speaker ? 'now' : i < state.speaker ? 'done' : '')).join('');
      const cur = order[state.speaker];
      const instr = cur
        ? `Рассказывает <b>${esc(cur.name)}</b> — часть «Расскажите всем». Тайную часть — по желанию.`
        : 'Все рассказали. Переходим к обсуждению.';
      return `<div class="screen"><div class="round-head"><div class="n">Раунд ${R.n} · ${R.time}</div><h1>${esc(R.title)}</h1></div>
        <p class="instr" style="margin-top:3vh">Прочитайте свою карточку в телефоне молча.</p>
        <div class="people">${people}</div>
        <p class="instr">${instr}</p>
        ${cur ? '<div style="text-align:center;margin-top:1.5vh"><button class="btn ghost" data-act="speaker">Следующий рассказчик</button></div>' : ''}
        ${boardHTML()}</div>`;
    }
    case 'r-discuss': {
      const R = ROUNDS[s.r - 1];
      setBg(R.bg, true);
      return `<div class="screen center"><div class="n" style="color:var(--ghost);font-family:var(--display);font-size:3vh">Раунд ${R.n} · ${esc(R.title)}</div>
        <h1 class="big-title">Обсуждение</h1>
        <p class="sub">Кто где был? Что не сходится? Записывайте подозрения.${s.r >= 4 ? ' Если в телефоне появилось решение — его можно принять в любой момент.' : ''}</p>
        ${boardHTML()}</div>`;
    }
    case 'm-intro':
      setBg('BG-07');
      return `<div class="screen"><div class="scroll parch big">${esc(MIDNIGHT.intro)}</div></div>`;
    case 'm-cards':
      setBg('BG-07', true);
      return `<div class="screen center"><h1 class="big-title">Полночь</h1>
        <p class="sub">Читайте последнюю карточку молча. С этой минуты виновному разрешено лгать. Остальные говорят правду.</p>${boardHTML()}</div>`;
    case 'm-discuss':
      setBg('BG-01', true);
      return `<div class="screen center"><h1 class="big-title">Последнее обсуждение</h1>
        <p class="sub">Открыт камбуз. Сопоставьте всё, что знаете. После этого — голосование.</p>${zonesHTML(true)}${boardHTML()}</div>`;
    case 'vote': {
      setBg('BG-01', true);
      const barrels = state.players.map(p => {
        const R = ROLES[p.role];
        return `<div class="barrel"><div class="nm">${esc(p.name)}</div><div class="rl">${esc(R.name)}</div><div class="mark">${state.votes[p.key] ? '✓' : ''}</div></div>`;
      }).join('');
      const n = Object.keys(state.votes).length;
      return `<div class="screen center"><h1 class="big-title">Кто погубил Сайласа Корвина?</h1>
        <p class="sub">Голосуйте в телефоне: кто виновен, чем убили и зачем. Себя выбрать нельзя. Проголосовали ${n} из ${state.count}.</p>
        <div class="barrels">${barrels}</div></div>`;
    }
    case 'votes': {
      setBg('BG-01', true);
      const res = G.results(state);
      const max = Math.max(...Object.values(res.tally));
      const barrels = state.players.map(p => {
        const R = ROLES[p.role];
        const who = state.players.filter(v => state.votes[v.key] && state.votes[v.key].suspect === p.key).map(v => v.name).join(', ');
        return `<div class="barrel ${res.tally[p.key] === max && max > 0 ? 'lead' : ''}"><div class="nm">${esc(p.name)}</div><div class="rl">${esc(R.name)}</div>
          <div class="cnt">${res.tally[p.key]}</div><div class="who">${esc(who)}</div></div>`;
      }).join('');
      return `<div class="screen center"><h1 class="big-title">Голоса</h1><p class="sub">Сейчас узнаем, раскрыто ли дело.</p><div class="barrels">${barrels}</div></div>`;
    }
    case 'verdict': {
      const res = G.results(state);
      setBg(res.solved ? 'UI-08' : 'UI-09');
      const k = G.playerByRole(state, GUILTY);
      return res.solved
        ? `<div class="screen center"><h1 class="big-title">Дело раскрыто!</h1><div class="verdict-box parch">Виновный — ${esc(ROLES[GUILTY].name)}. В этой роли — ${esc(k.name)}. На рассвете береговая охрана поднимается на борт.</div></div>`
        : `<div class="screen center"><h1 class="big-title">Дело не раскрыто</h1><div class="verdict-box parch">Призрак смеётся последним. Виновный — ${esc(ROLES[GUILTY].name)}. В этой роли — ${esc(k.name)}.</div></div>`;
    }
    case 'epi': {
      const E = EPILOGUE[s.i];
      setBg(E.bg, !!E.list);
      if (E.big) return `<div class="screen cast"><div class="portrait" style="background-image:url('${IMG(E.portrait)}')"></div><div class="info"><div class="parch" style="font-family:var(--display);font-size:5vh;line-height:1.2;padding:4vh">${esc(E.text)}</div></div></div>`;
      const body = E.list ? `<h3>${esc(E.title)}</h3><ul>${E.list.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : `<p>${esc(E.text)}</p>`;
      return `<div class="screen"><div class="scroll parch">${body}</div></div>`;
    }
    case 'scores': {
      const res = G.results(state);
      setBg(res.solved ? 'UI-08' : 'UI-09', true);
      const rows = res.scores.map((sc, i) => `<tr class="${res.winners.includes(sc.key) ? 'win' : ''}">
        <td class="place">${i + 1}</td>
        <td><div class="pl">${esc(sc.name)}</div><div class="rl">${esc(ROLES[sc.role].name)}</div></td>
        <td class="lines">${sc.lines.map(l => `${esc(l.label)}: ${l.pts > 0 ? '+' : ''}${l.pts}`).join('<br>') || 'Очков нет'}</td>
        <td class="tot">${sc.total}</td></tr>`).join('');
      const wn = res.scores.filter(x => res.winners.includes(x.key)).map(x => x.name).join(', ');
      return `<div class="screen"><h1 class="big-title" style="margin:2vh 0 0;font-size:7vh">Победитель: ${esc(wn)}</h1>
        <div class="scores parch"><table>${rows}</table></div>
        <div style="text-align:center;margin-top:2vh"><button class="btn ghost" data-act="newgame">Новая игра</button></div></div>`;
    }
    default:
      return `<div class="screen">${esc(s.id)} ${state.step}/${all.length}</div>`;
  }
}

function zonesHTML(small = false) {
  const open = G.zonesOpen(state);
  const unl = { prologue: 'открыта', round3: 'после раунда 2', round5: 'после раунда 4', midnight: 'в полночь' };
  return `<div class="zones" ${small ? 'style="transform:scale(.8);margin-top:0"' : ''}>${ZONES.map(z => {
    const o = open.includes(z.id);
    const img = state.decisions.D5 === true && z.imgNoJar ? z.imgNoJar : z.img;
    return `<div class="zone ${o ? '' : 'locked'}"><div class="im" style="background-image:url('${IMG(img)}')"></div><div class="nm">${esc(z.name)}</div><div class="st">${o ? 'можно осматривать' : unl[z.unlock]}</div></div>`;
  }).join('')}</div>`;
}

function stepLabel() {
  const s = G.cur(state);
  const L = {
    lobby: 'Сбор гостей', roles: 'Раздача ролей', cast: 'Знакомство', prologue: 'Пролог', inspect: 'Осмотр',
    'r-intro': `Раунд ${s.r}: вступление`, 'r-cards': `Раунд ${s.r}: рассказы`, 'r-discuss': `Раунд ${s.r}: обсуждение`,
    'm-intro': 'Полночь', 'm-cards': 'Полночь: карточки', 'm-discuss': 'Полночь: обсуждение',
    vote: 'Голосование', votes: 'Голоса', verdict: 'Вердикт', epi: 'Эпилог', scores: 'Итоги',
  };
  return L[s.id] || s.id;
}

function renderDock() {
  const all = G.steps(state);
  const s = G.cur(state);
  const t = state.timer;
  const timerBtns = t ? `<button class="icon" data-act="pause" title="Пауза (P)" aria-label="Пауза таймера">${t.endsAt ? '❚❚' : '▶'}</button>
    <button class="btn ghost" data-act="plus" title="Добавить минуту">+1 мин</button>` : '';
  $('#dock').innerHTML = `
    <button class="btn ghost" data-act="prev" ${state.step <= 1 ? 'disabled' : ''}>Назад</button>
    <span class="where">${esc(stepLabel())}</span>
    <div class="progress" aria-hidden="true"><i style="width:${(state.step / (all.length - 1)) * 100}%"></i></div>
    ${timerBtns}
    <button class="icon" data-act="mute" aria-pressed="${audio.muted}" title="Звук (M)" aria-label="Выключить звук">♪</button>
    <button class="icon" data-act="fs" title="Во весь экран (F)" aria-label="Во весь экран">⛶</button>
    ${s.id === 'lobby' ? '' : `<button class="btn" data-act="next" ${G.canAdvance(state) ? '' : 'disabled'}>Далее</button>`}`;
}

function renderClock() {
  const el = $('#clock');
  const t = state && state.timer;
  if (!t) { el.hidden = true; return; }
  el.hidden = false;
  const left = G.timerLeft(t);
  el.className = 'clock' + (t.endsAt ? '' : ' paused') + (left < 30000 && left > 0 ? ' low' : '');
  el.innerHTML = `<div class="t">${fmt(left)}</div><div class="l">${t.endsAt ? (left > 0 ? 'осталось' : 'время вышло') : 'пауза'}</div>`;
  if (t.endsAt && left <= 10500 && left > 9000 && !tickWarned) { tickWarned = true; audio.sfx('SFX-21', { gain: 0.6 }); }
}

function render() {
  if (!state) return;
  renderTop();
  const html = screenHTML() + (revealShowing ? revealHTML(revealShowing) : '');
  if (html !== lastRendered) { $('#screen').innerHTML = html; lastRendered = html; }
  renderDock();
  renderClock();
}

let toastT;
function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- Титульный экран ----------
function renderTitle() {
  setBg('UI-02');
  const saved = loadSaved();
  $('#dock').innerHTML = '';
  $('#clock').hidden = true;
  $('#top').innerHTML = '';
  const savedInfo = saved && saved.step > 0
    ? `<button class="btn ghost" data-act="resume">Продолжить игру ${saved.code}</button>` : '';
  $('#screen').innerHTML = `<div class="screen title-screen">
    <h1 class="logo">Призрак<br>Огнеборода<small>Детектив на одну хэллоуинскую ночь</small></h1>
    <div class="controls">
      <div class="count-pick" role="group" aria-label="Число игроков">Игроков:
        ${[3, 4, 5].map(n => `<button data-count="${n}" aria-pressed="${n === pendingCount}">${n}</button>`).join('')}
      </div>
      <button class="btn" data-act="start">Новая игра</button>
      ${savedInfo}
      <p class="hint">${pendingCount === 3 ? 'Дворецкий, капитан и кок.' : pendingCount === 4 ? 'Дворецкий, капитан, кок и репортёр Агата.' : 'Все пять ролей: дворецкий, капитан, кок, Агата и Тоби.'} Телефоны и экран должны быть подключены к интернету, лучше к одной сети Wi‑Fi.</p>
    </div></div>`;
}

function startGame(resume) {
  audio.unlock();
  if (resume) state = loadSaved();
  if (!state) state = G.newState(pendingCount);
  lastRendered = '';
  startNet();
  cue();
  changed();
}

// ---------- События ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act],[data-count],[data-kick],[data-replay]');
  if (!b) return;
  audio.unlock();
  if (b.dataset.count) { pendingCount = Number(b.dataset.count); renderTitle(); return; }
  if (b.dataset.kick) {
    const k = b.dataset.kick;
    if (G.removePlayer(state, k)) { const c = keyConn.get(k); if (c) { net.send(c, { t: 'kicked' }); keyConn.delete(k); } changed(); }
    return;
  }
  if (b.dataset.replay) { showReveal(b.dataset.replay); return; }
  switch (b.dataset.act) {
    case 'start': localStorage.removeItem(SAVE_KEY); startGame(false); break;
    case 'resume': startGame(true); break;
    case 'next': advance(1); break;
    case 'prev': advance(-1); break;
    case 'speaker': nextSpeaker(); changed(); break;
    case 'pause': G.timerPause(state); changed(); break;
    case 'plus': G.timerAdd(state, 60); tickWarned = false; changed(); break;
    case 'mute': audio.setMuted(!audio.muted); renderDock(); break;
    case 'fs': toggleFs(); break;
    case 'newgame':
      if (confirm('Начать новую игру? Текущая будет удалена.')) {
        localStorage.removeItem(SAVE_KEY);
        if (net) net.destroy();
        state = null; audio.music(null); bgCurrent = null; renderTitle();
      }
      break;
    default:
  }
});

document.addEventListener('keydown', e => {
  if (!state || e.target.closest('input,textarea')) return;
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); if (G.cur(state).id !== 'lobby' || G.canAdvance(state)) advance(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { if (state.step > 1) advance(-1); }
  else if (e.key === 'Escape' && revealShowing) closeReveal();
  else if (e.key === 'm' || e.key === 'ь') { audio.setMuted(!audio.muted); renderDock(); }
  else if (e.key === 'f' || e.key === 'а') toggleFs();
  else if ((e.key === 'p' || e.key === 'з') && state.timer) { G.timerPause(state); changed(); }
});

function toggleFs() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

setInterval(() => { if (state) renderClock(); }, 500);
setInterval(() => { if (state) renderTop(); }, 5000);
// периодически сверяем часы на телефонах
setInterval(() => { if (state && state.timer && net) broadcast(); }, 15000);

renderTitle();
window.__game = { get state() { return state; }, G, audio };
