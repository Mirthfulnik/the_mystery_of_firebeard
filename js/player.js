// Телефон игрока: роль, карточки, осмотр, пометки, решения, голосование.
import { Channel } from './net.js';
import { GameAudio } from './audio.js';
import { esc, IMG, FACE, fmt, store, hashParams, envHTML, decisionHTML, confirmHTML, evImgHTML, buzz, toast } from './ui.js';

const $ = s => document.querySelector(s);
const { room, secret, broker } = hashParams();
let key = store.get('key', null);
if (!key) { key = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('key', key); }
let name = store.get('name', '');

const audio = new GameAudio();
audio.musicVol = 0;
let ch = null;
let netState = 'off';
let view = null;
let viewAt = 0;
let screen = room && secret ? 'join' : 'nolink';
let seats = [];
let tab = 'card';
let opened = store.get('opened', {});
let seen = store.get('seen', {});
let notes = store.get('notes.' + room, '');
let zoneSel = null;
let sheet = null;
let covered = false;
let voteDraft = {};
let lastSig = {};
const newTabs = {};
let joined = false;

// ---------- Связь ----------
function connect() {
  if (ch) return;
  ch = new Channel({
    room, secret, broker, mine: key,
    onStatus: s => { netState = s; renderBar(); },
    onConnect: () => { if (joined) send({ t: 'hello', name }); },
    onMsg,
  });
  setInterval(() => { if (joined) send({ t: 'ping', rev: view ? view.rev : 0 }); }, 5000);
}
function send(m) { if (ch) ch.toHost({ ...m, key }); }

function onMsg(m) {
  if (m.t === 'view') {
    const prev = view;
    view = m.v; viewAt = Date.now(); screen = 'game'; joined = true;
    notice(prev, view);
    render();
  } else if (m.t === 'seats') { seats = m.seats; screen = 'seats'; render(); clearTimeout(onMsg.rt); if (!seats.length) onMsg.rt = setTimeout(() => send({ t: 'hello', name }), 5000); }
  else if (m.t === 'full') { screen = 'full'; render(); }
  else if (m.t === 'kicked') { screen = 'kicked'; view = null; joined = false; render(); }
  else if (m.t === 'hello?') send({ t: 'hello', name });
}

function notice(prev, v) {
  if (!v.me || !v.me.role) return;
  const sig = { cards: (v.cards || []).length, zones: (v.zones || []).length, dec: (v.decisions || []).filter(d => d.open && d.made === undefined).length, wh: (v.whispers || []).length, turn: !!v.myTurn, phase: v.phase };
  if (prev && prev.me && prev.me.role) {
    if (sig.cards > lastSig.cards) { newTabs.card = true; buzz([60, 40, 60]); audio.sfx('SFX-18'); tab = 'card'; }
    if (sig.zones > lastSig.zones) { newTabs.zones = true; buzz(80); }
    if (sig.dec > lastSig.dec || sig.wh > lastSig.wh) { newTabs.card = true; buzz([150, 60, 150]); }
    if (sig.turn && !lastSig.turn) { buzz(250); tab = 'card'; }
    if (sig.phase !== lastSig.phase) {
      if (sig.phase === 'inspect') { tab = 'zones'; if (v.focusZone) zoneSel = v.focusZone; }
      if (['vote', 'verdict', 'roles'].includes(sig.phase)) tab = 'card';
    }
  }
  lastSig = sig;
}

// ---------- Отрисовка ----------
function timerLeft() {
  if (!view || view.timer == null) return null;
  return view.timerRunning ? Math.max(0, view.timer - (Date.now() - viewAt)) : view.timer;
}

function renderBar() {
  const el = $('#bar');
  if (screen !== 'game' || !view) { el.hidden = true; return; }
  el.hidden = false;
  const me = view.me || {};
  const left = timerLeft();
  el.innerHTML = `${me.portrait ? `<img class="mini" src="${FACE(me.portrait)}" alt="">` : ''}
    <div class="ttl"><b>${esc(me.roleName || me.name || '')}</b><span>${esc(view.label)}</span></div>
    ${left != null ? `<span class="tmr ${left < 30000 ? 'low' : ''}" id="tmr">${fmt(left)}</span>` : ''}
    <button class="ib" data-act="cover" aria-label="Скрыть экран">Скрыть</button>
    <span class="conn ${netState === 'online' ? 'ok' : ''}" title="${netState === 'online' ? 'на связи' : 'нет связи'}"></span>`;
}

function renderTabs() {
  const el = $('#tabs');
  if (screen !== 'game' || !view || !view.me || !view.me.role) { el.hidden = true; return; }
  el.hidden = false;
  const zonesN = (view.zones || []).length;
  const T = [['card', '✉', 'Карточка'], ['zones', '⌕', 'Осмотр'], ['notes', '✎', 'Пометки'], ['role', '☠', 'Роль']];
  el.innerHTML = T.map(([id, i, l]) => `<button role="tab" aria-selected="${tab === id}" data-tab="${id}" ${id === 'zones' && !zonesN ? 'disabled style="opacity:.4"' : ''}>
    <span class="i" aria-hidden="true">${i}</span>${l}${newTabs[id] && tab !== id ? '<span class="new"></span>' : ''}</button>`).join('');
}

function render() {
  renderBar();
  renderTabs();
  const m = $('#main');
  if (screen === 'nolink') m.innerHTML = `<div class="msg"><h2>Нужна ссылка игры</h2><p>Отсканируйте QR-код на экране телевизора или откройте ссылку, которую прислал ведущий.</p></div>`;
  else if (screen === 'join') m.innerHTML = joinHTML();
  else if (screen === 'seats') m.innerHTML = seatsHTML();
  else if (screen === 'full') m.innerHTML = `<div class="msg"><h2>Мест нет</h2><p>В игре уже пять игроков — все персонажи заняты.</p></div>`;
  else if (screen === 'kicked') m.innerHTML = `<div class="msg"><h2>Вас убрали из списка</h2><p>Чтобы вернуться, обновите страницу.</p></div>`;
  else if (view) {
    if (tab === 'notes' && document.getElementById('notes')) { /* не перерисовывать блокнот, пока в нём пишут */ }
    else m.innerHTML = gameHTML();
  }
  newTabs[tab] = false;
  renderSheet();
  $('#cover').hidden = !covered;
}

function joinHTML() {
  return `<div class="join">
    <img class="ghostimg" src="img/ch/CH-06.webp" alt="">
    <div class="logo">Призрак Огнеборода</div>
    <div class="tag">Детектив на одну хэллоуинскую ночь</div>
    <form id="joinform">
      <label for="name">Как вас зовут?</label>
      <input id="name" value="${esc(name)}" maxlength="20" autocomplete="nickname" required>
      <button class="btn" type="submit">Подняться на борт</button>
    </form>
    <p class="small" style="margin-top:14px">Комната ${esc(room)}${netState === 'online' ? '' : ' · подключаемся…'}</p></div>`;
}

function seatsHTML() {
  if (!seats.length) return `<div class="msg"><h2>Игра уже идёт</h2><p>Сейчас все игроки на связи. Если вы сменили телефон, закройте игру на старом — через несколько секунд здесь появится ваше имя.</p></div>`;
  return `<div class="msg"><h2>Игра уже идёт</h2><p>Если вы сменили телефон или браузер, выберите себя — и продолжите с того же места.</p>
    <div class="seatlist">${seats.map(s => `<button class="btn ghost" data-seat="${esc(s.key)}">Я — ${esc(s.name)}</button>`).join('')}</div></div>`;
}

function gameHTML() {
  const v = view;
  if (!v.me) return `<div class="msg"><h2>Подключение…</h2></div>`;
  if (!v.me.role) {
    return `<div class="msg"><h2>Вы на борту, ${esc(v.me.name)}</h2>
      <p>Уже подключились: ${v.players.length}. Ждём, когда ведущий раздаст роли.</p>
      <ul class="names">${v.players.map(p => `<li>${esc(p.name)}</li>`).join('')}</ul>
      <p class="small">Не закрывайте страницу. Если она закроется — откройте ссылку снова, место сохранится.</p></div>`;
  }
  if (tab === 'role') return roleHTML(false);
  if (tab === 'zones') return zonesHTML();
  if (tab === 'notes') return notesHTML();
  return cardTabHTML();
}

function roleHTML(hint) {
  const me = view.me;
  return `<div class="role"><div class="por" style="background-image:url('${IMG(me.portrait)}')"></div>
    <h1>${esc(me.roleName)}</h1><div class="t">${esc(me.roleTitle)}</div>
    <div class="parch">${esc(me.desc)}</div>
    <p class="say">${hint ? 'Когда ваш персонаж появится на экране — прочитайте это описание вслух.' : 'Роли знают все. Тайны — только вы.'}</p></div>`;
}

function notesHTML() {
  return `<div class="notes"><h2>Пометки</h2>
    <p class="small">Записывайте подозрения, время и кто что сказал. Видите только вы.</p>
    <textarea id="notes" placeholder="Например: 23:35 — кок с подносом. Почему арахис целый?">${esc(notes)}</textarea>
    <p class="small" id="notesSaved">Сохраняется само</p></div>`;
}

function cardTabHTML() {
  const v = view;
  const ph = v.phase;
  const cards = v.cards || [];
  let top = '';
  (v.whispers || []).forEach(w => { top += `<div class="banner whisper"><b>Тайное сообщение</b>${esc(w.text)}</div>`; });
  if (ph === 'roles' || ph === 'cast') return roleHTML(true);
  if (ph === 'vote') return top + voteHTML();
  if (['votes', 'verdict', 'epi', 'scores'].includes(ph)) return v.result ? resultHTML() : `<div class="msg"><h2>Голоса подсчитаны</h2><p>Смотрите на экран.</p></div>`;
  if (ph === 'r-cards') {
    if (v.myTurn) top += `<div class="banner turn"><b>Ваша очередь рассказывать</b>Перескажите своими словами часть «Расскажите всем». Тайную — по желанию.<button class="btn" data-act="told">Я закончил рассказ</button></div>`;
    else if (v.told) top += `<div class="banner info">Вы уже рассказали. Слушайте остальных.</div>`;
  }
  if (ph === 'inspect' && cards.length) {
    const fz = (v.zones || []).find(z => z.id === v.focusZone);
    top += `<div class="banner turn"><b>Открыто новое место${fz ? ': ' + esc(fz.name) : ''}</b>Обыщите его до обсуждения.<button class="btn" data-tab="zones">Открыть осмотр</button></div>`;
  }
  const decs = (v.decisions || []).map(decisionHTML).join('');
  if (!cards.length) {
    const wait = { prologue: 'Смотрите на экран: начинается история.', inspect: 'Откройте вкладку «Осмотр» и обыщите место преступления.', 'r-intro': 'Слушайте вступление.' };
    return top + `<div class="msg"><h2>${ph === 'inspect' ? 'Осмотр' : 'Смотрите на экран'}</h2><p>${wait[ph] || 'Скоро здесь появится ваша первая карточка.'}</p>
      ${ph === 'inspect' ? '<button class="btn" data-tab="zones">Открыть осмотр</button>' : ''}</div>`;
  }
  const latest = cards[cards.length - 1];
  const past = cards.slice(0, -1).reverse();
  let hint = '';
  if (ph === 'r-intro') hint = `<div class="banner info">Слушайте вступление. Новая карточка появится, когда начнутся рассказы.</div>`;
  if (ph === 'm-intro') hint = `<div class="banner info">Полночь. Сейчас откроется последняя карточка.</div>`;
  const body = latest.final !== undefined ? envHTML(latest, opened) + decs : decs + envHTML(latest, opened);
  return top + hint + body + (past.length ? `<details class="past"><summary>Прошлые карточки (${past.length})</summary>${past.map(c => envHTML(c, opened)).join('')}</details>` : '');
}

function zonesHTML() {
  const zs = view.zones || [];
  if (!zs.length) return `<div class="msg"><h2>Пока закрыто</h2><p>Место преступления откроется после пролога.</p></div>`;
  if (!zoneSel || !zs.some(z => z.id === zoneSel)) zoneSel = zs[0].id;
  const z = zs.find(zz => zz.id === zoneSel);
  const sk = (zz, it) => zz.id + '.' + it.id + (it.img || '');
  const chips = zs.map(zz => { const left = zz.items.filter(it => !seen[sk(zz, it)]).length; return `<button aria-pressed="${zz.id === zoneSel}" data-zone="${zz.id}">${esc(zz.name)}${left ? ` · ${left}` : ' ✓'}</button>`; }).join('');
  const hots = z.items.map(it => `<button class="hot ${seen[sk(z, it)] ? 'seen' : ''}" style="left:${it.x}%;top:${it.y}%;width:${it.r * 2}%;aspect-ratio:1" data-item="${it.id}" aria-label="${esc(it.name)}"></button>`).join('');
  return `<div class="chips" role="group" aria-label="Места">${chips}</div>
    <div class="scene"><img src="${IMG(z.img)}" alt="${esc(z.name)}">${hots}</div>
    <p class="scene-hint">Ищите улики сами: нажимайте на всё, что кажется подозрительным. Находки видят все игроки — обсуждайте их вслух.</p>`;
}

function voteHTML() {
  const V = view.vote;
  const mine = V.mine || {};
  const d = { suspect: voteDraft.suspect ?? mine.suspect, method: voteDraft.method ?? mine.method, motive: voteDraft.motive ?? mine.motive };
  const opt = (n, val, label, sub, face) => `<label class="opt"><input type="radio" name="${n}" value="${esc(val)}" ${d[n] === val ? 'checked' : ''}>${face ? `<img class="av" src="${face}" alt="">` : ''}<span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></label>`;
  const faces = { butler: 'CH-01', captain: 'CH-02', cook: 'CH-03', agata: 'CH-04', toby: 'CH-05' };
  const ready = d.suspect && d.method && d.motive;
  return `<form class="vote" id="voteform"><h2>Ваш голос</h2>
    <p class="small" style="margin:0 0 16px">Голосуют тайно. Проголосовали ${V.done} из ${V.of}. Голос можно изменить, пока экран не перешёл дальше.</p>
    ${mine.suspect ? '<div class="banner">Голос принят. Можно изменить.</div>' : ''}
    <fieldset><legend>Кто виновен?</legend>${V.suspects.map(s => opt('suspect', s.role, s.roleName, 'играет ' + s.who, FACE(faces[s.role]))).join('')}</fieldset>
    <fieldset><legend>Чем убили?</legend>${V.methods.map(m => opt('method', m.id, m.label)).join('')}</fieldset>
    <fieldset><legend>Какой мотив?</legend>${V.motives.map(m => opt('motive', m.id, m.label)).join('')}</fieldset>
    <button class="btn" type="submit" ${ready ? '' : 'disabled'}>${mine.suspect ? 'Изменить голос' : 'Отдать голос'}</button></form>`;
}

function resultHTML() {
  const r = view.result;
  if (!r.showScores) return `<div class="result"><h2>${r.solved ? 'Дело раскрыто!' : 'Дело не раскрыто'}</h2><p>Виновный — ${esc(r.killerName)}.</p><p class="small">Смотрите на экран: там эпилог и разгадка.</p></div>`;
  const me = r.me;
  return `<div class="result"><p class="small">${r.solved ? 'Дело раскрыто' : 'Дело не раскрыто'}. Виновный — ${esc(r.killerName)}.</p>
    <h2>${r.winner ? 'Вы победили!' : `Ваше место: ${r.place}`}</h2>
    <div class="pts">${me.total}</div><div class="small">очков</div>
    <ul>${me.lines.map(l => `<li><span>${esc(l.label)}</span><b>${l.pts > 0 ? '+' : ''}${l.pts}</b></li>`).join('') || '<li><span>Очков нет</span><b>0</b></li>'}</ul>
    <p class="small">Спасибо за игру! С Хэллоуином.</p></div>`;
}

function renderSheet() {
  const el = $('#sheet');
  if (!sheet) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  let inner = '';
  if (sheet.type === 'item') {
    const z = (view.zones || []).find(zz => zz.id === sheet.zone);
    const it = z && z.items.find(i => i.id === sheet.item);
    if (!it) { sheet = null; el.hidden = true; return; }
    inner = `<h3>${esc(it.name)}</h3>${evImgHTML(it.img, it.note)}<p style="font-size:18px">${esc(it.text)}</p>
      <button class="btn" data-act="closesheet" style="width:100%;margin-top:10px">Понятно</button>`;
  } else if (sheet.type === 'confirm') {
    inner = confirmHTML((view.decisions || []).find(x => x.id === sheet.d), sheet.yes);
  }
  el.innerHTML = `<div class="sheet-back" data-act="closeback"><div class="sheet parch" role="dialog">${inner}</div></div>`;
}

// ---------- События ----------
document.addEventListener('submit', e => {
  e.preventDefault();
  audio.unlock();
  if (e.target.id === 'joinform') {
    name = $('#name').value.trim().slice(0, 20);
    if (!name) return;
    store.set('name', name);
    joined = true;
    connect();
    send({ t: 'hello', name });
    toast('Подключаемся к экрану…');
  } else if (e.target.id === 'voteform') {
    const fd = new FormData(e.target);
    const vote = { suspect: fd.get('suspect'), method: fd.get('method'), motive: fd.get('motive') };
    if (!vote.suspect || !vote.method || !vote.motive) return;
    send({ t: 'vote', vote });
    voteDraft = {};
    buzz(60);
  }
});

document.addEventListener('input', e => {
  if (e.target.id === 'notes') {
    notes = e.target.value;
    store.set('notes.' + room, notes);
  }
});

document.addEventListener('change', e => {
  if (e.target.closest('#voteform')) {
    voteDraft[e.target.name] = e.target.value;
    const f = $('#voteform');
    const fd = new FormData(f);
    f.querySelector('button[type=submit]').disabled = !(fd.get('suspect') && fd.get('method') && fd.get('motive'));
  }
});

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-tab],[data-open],[data-close],[data-zone],[data-item],[data-decide],[data-seat]');
  if (!t) return;
  audio.unlock();
  const ds = t.dataset;
  if (ds.tab) { tab = ds.tab; newTabs[tab] = false; $('#main').innerHTML = ''; render(); window.scrollTo(0, 0); return; }
  if (ds.open) { opened[ds.open] = true; store.set('opened', opened); audio.sfx('SFX-18'); render(); return; }
  if (ds.close) { delete opened[ds.close]; store.set('opened', opened); render(); return; }
  if (ds.zone) { zoneSel = ds.zone; render(); return; }
  if (ds.item) {
    const z = (view.zones || []).find(zz => zz.id === zoneSel);
    const it = z && z.items.find(i => i.id === ds.item);
    if (it) { seen[z.id + '.' + it.id + (it.img || '')] = true; store.set('seen', seen); if (it.sfx) audio.sfx(it.sfx, { gain: 0.7 }); }
    sheet = { type: 'item', zone: zoneSel, item: ds.item };
    render();
    return;
  }
  if (ds.decide) { sheet = { type: 'confirm', d: ds.decide, yes: ds.yes === '1' }; renderSheet(); return; }
  if (ds.seat) { send({ t: 'reclaim', seat: ds.seat }); return; }
  switch (ds.act) {
    case 'told': send({ t: 'told' }); buzz(40); break;
    case 'cover': covered = true; render(); break;
    case 'uncover': covered = false; render(); break;
    case 'confirm': send({ t: 'decide', d: sheet.d, yes: sheet.yes }); audio.sfx('SFX-19'); sheet = null; renderSheet(); break;
    case 'closesheet': sheet = null; render(); break;
    case 'closeback': if (e.target === t) { sheet = null; render(); } break;
    default:
  }
});

setInterval(() => {
  const el = document.getElementById('tmr');
  if (el) { const l = timerLeft(); if (l != null) { el.textContent = fmt(l); el.classList.toggle('low', l < 30000); } }
}, 500);

// вернувшийся игрок подключается сам
if (screen === 'join' && name && store.get('room', '') === room) { joined = true; connect(); }
if (room) store.set('room', room);
if (screen === 'join') connect();
render();
