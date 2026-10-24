// Телефон игрока: роль, карточки, осмотр, решения, голосование.
import { PlayerNet } from './net.js';
import { GameAudio } from './audio.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const IMG = id => {
  if (!id) return '';
  if (id.startsWith('CH-')) return `img/ch/${id}.webp`;
  if (id.startsWith('SC-')) return `img/sc/${id}.webp`;
  return `img/ev/${id}.webp`;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('ognebord.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ognebord.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

const q = new URLSearchParams(location.search);
let room = (q.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '');
let key = store.get('key', null);
if (!key) { key = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('key', key); }
let name = store.get('name', '');

const audio = new GameAudio();
audio.musicVol = 0;
let net = null;
let online = false;
let view = null;
let viewAt = 0;
let screen = 'join';        // join | seats | full | game | kicked
let seats = [];
let tab = 'card';
let opened = store.get('opened', {});    // сломанные печати
let seen = store.get('seen', {});        // осмотренные предметы
let zoneSel = null;
let sheet = null;           // {type:'item'|'confirm'|'remote', ...}
let covered = false;
let voteDraft = {};
let lastSig = {};
let newTabs = {};

// ---------- Сеть ----------
function connect() {
  net = new PlayerNet(room, {
    onStatus: s => { online = s === 'online'; renderBar(); if (s === 'nohost' && screen === 'join') toast('Экран ведущего не найден. Проверьте код комнаты.'); },
    onMsg,
    getJoin: () => ({ t: 'join', key, name }),
  });
}

function onMsg(m) {
  if (m.t === 'view') {
    const prev = view;
    view = m.v;
    viewAt = Date.now();
    screen = 'game';
    notice(prev, view);
    render();
  } else if (m.t === 'seats') {
    seats = m.seats; screen = 'seats'; render();
    // место может освободиться, когда старый телефон отключится
    clearTimeout(onMsg.retry);
    if (!seats.length) onMsg.retry = setTimeout(() => { if (screen === 'seats') send({ t: 'join', key, name }); }, 5000);
  } else if (m.t === 'full') {
    screen = 'full'; render();
  } else if (m.t === 'kicked') {
    screen = 'kicked'; view = null; render();
  }
}

// подсказки о новом: вибрация, звук, точки на вкладках
function notice(prev, v) {
  if (!v.me || !v.me.role) return;
  const sig = {
    cards: (v.cards || []).length,
    zones: (v.zones || []).length,
    dec: (v.decisions || []).filter(d => d.open && d.made === undefined).length,
    wh: (v.whispers || []).length,
    turn: v.speakerKey === key,
    phase: v.phase,
  };
  if (prev && prev.me && prev.me.role) {
    if (sig.cards > lastSig.cards) { newTabs.card = true; buzz([60, 40, 60]); audio.sfx('SFX-18'); if (tab !== 'card') tab = 'card'; }
    if (sig.zones > lastSig.zones) { newTabs.zones = true; buzz(80); }
    if (sig.dec > lastSig.dec) { newTabs.card = true; buzz([120, 60, 120]); }
    if (sig.wh > lastSig.wh) { newTabs.card = true; buzz([200, 80, 200]); }
    if (sig.turn && !lastSig.turn) { buzz([250]); tab = 'card'; }
    if (sig.phase !== lastSig.phase) {
      if (sig.phase === 'inspect') tab = 'zones';
      if (sig.phase === 'vote' || sig.phase === 'verdict' || sig.phase === 'roles') tab = 'card';
    }
  }
  lastSig = sig;
}
function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }

function send(m) { if (!net || !net.send(m)) toast('Нет связи с экраном. Переподключаемся…'); }

// ---------- Отрисовка ----------
const PHASE = {
  lobby: 'Сбор гостей', roles: 'Раздача ролей', cast: 'Знакомство', prologue: 'Пролог', inspect: 'Осмотр',
  'r-intro': 'Вступление', 'r-cards': 'Рассказы', 'r-discuss': 'Обсуждение',
  'm-intro': 'Полночь', 'm-cards': 'Полночь', 'm-discuss': 'Последнее обсуждение',
  vote: 'Голосование', votes: 'Голоса', verdict: 'Вердикт', epi: 'Эпилог', scores: 'Итоги',
};

function timerLeft() {
  if (!view || view.timer == null) return null;
  return view.timerRunning ? Math.max(0, view.timer - (Date.now() - viewAt)) : view.timer;
}
const fmt = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function renderBar() {
  const el = $('#bar');
  if (screen !== 'game' || !view) { el.hidden = true; return; }
  el.hidden = false;
  const me = view.me || {};
  const left = timerLeft();
  const ph = PHASE[view.phase] || '';
  const sub = view.r ? `Раунд ${view.r} · ${ph}` : ph;
  const isCap = view.captainKey === key && view.phase !== 'lobby';
  el.innerHTML = `${me.portrait ? `<div class="mini" style="background-image:url('${IMG(me.portrait)}')"></div>` : ''}
    <div class="ttl"><b>${esc(me.roleName || me.name || '')}</b><span>${esc(sub)}</span></div>
    ${left != null ? `<span class="tmr ${left < 30000 ? 'low' : ''}" id="tmr">${fmt(left)}</span>` : ''}
    ${isCap ? '<button class="ib" data-act="remote">Пульт</button>' : ''}
    <button class="ib" data-act="cover" aria-label="Скрыть экран">Скрыть</button>
    <span class="conn ${online ? 'ok' : ''}" title="${online ? 'на связи' : 'нет связи'}"></span>`;
}

function renderTabs() {
  const el = $('#tabs');
  if (screen !== 'game' || !view || !view.me || !view.me.role) { el.hidden = true; return; }
  el.hidden = false;
  const zonesN = (view.zones || []).length;
  const T = [['card', '✉', 'Карточка'], ['zones', '⌕', 'Осмотр'], ['role', '☠', 'Роль']];
  el.innerHTML = T.map(([id, i, l]) => `<button role="tab" aria-selected="${tab === id}" data-tab="${id}" ${id === 'zones' && !zonesN ? 'disabled style="opacity:.4"' : ''}>
    <span class="i" aria-hidden="true">${i}</span>${l}${newTabs[id] && tab !== id ? '<span class="new"></span>' : ''}</button>`).join('');
}

function render() {
  renderBar();
  renderTabs();
  const m = $('#main');
  if (screen === 'join') m.innerHTML = joinHTML();
  else if (screen === 'seats') m.innerHTML = seatsHTML();
  else if (screen === 'full') m.innerHTML = `<div class="msg"><h2>Мест нет</h2><p>В этой игре все места уже заняты. Если вы играете, попросите ведущего начать игру с нужным числом игроков.</p></div>`;
  else if (screen === 'kicked') m.innerHTML = `<div class="msg"><h2>Вас убрали из списка</h2><p>Ведущий освободил ваше место. Чтобы вернуться, обновите страницу.</p></div>`;
  else if (view) m.innerHTML = gameHTML();
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
      ${room ? '' : '<label for="room">Код комнаты с экрана</label><input id="room" autocomplete="off" autocapitalize="characters" maxlength="5" required>'}
      <label for="name">Как вас зовут?</label>
      <input id="name" value="${esc(name)}" maxlength="20" autocomplete="nickname" required>
      <button class="btn" type="submit">Подняться на борт</button>
    </form>
    ${room ? `<p class="small" style="margin-top:14px">Комната ${esc(room)}</p>` : ''}</div>`;
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
      <p>Ждём остальных: ${v.players.length} из ${v.count}.</p>
      <ul class="names">${v.players.map(p => `<li>${esc(p.name)}</li>`).join('')}</ul>
      ${v.captainKey === key ? '<p class="small">Ваш телефон — пульт: когда игра начнётся, кнопка «Пульт» вверху листает экран.</p>' : ''}
      <p class="small">Не закрывайте эту страницу. Если она закроется — откройте ссылку снова, место сохранится.</p></div>`;
  }
  if (tab === 'role') return roleHTML();
  if (tab === 'zones') return zonesHTML();
  return cardTabHTML();
}

function roleHTML(withHint) {
  const me = view.me;
  return `<div class="role"><div class="por" style="background-image:url('${IMG(me.portrait)}')"></div>
    <h1>${esc(me.roleName)}</h1><div class="t">${esc(me.roleTitle)}</div>
    <div class="parch">${esc(me.desc)}</div>
    ${withHint ? '<p class="say">Когда ваш персонаж появится на экране — прочитайте это описание вслух.</p>' : '<p class="say">Роли знают все. Тайны — только вы.</p>'}</div>`;
}

function envHTML(c, open) {
  if (c.final !== undefined) {
    return `<article class="env"><div class="hd"><b>${esc(c.title)}</b><span>${esc(c.time)}</span></div>
      <div class="parch final ${c.guilty ? 'guilty' : ''}"><div class="verdict">${c.guilty ? 'Вы виновны.' : 'Финальная карточка'}</div><p>${esc(c.final)}</p></div></article>`;
  }
  const isOpen = !!opened[c.id];
  const img = c.img ? `<div class="evimg note-wrap"><img src="${IMG(c.img)}" alt="">${c.note ? `<div class="note-text">${esc(c.note)}</div>` : ''}</div>` : '';
  return `<article class="env" ${open ? '' : ''}><div class="hd"><b>${esc(c.title)}</b><span>${esc(c.time)}</span></div>
    <div class="parch">
      <div class="pub"><h4>Расскажите всем</h4><p>${esc(c.pub)}</p></div>
      <div class="sec ${isOpen ? '' : 'sealed'}">
        <div class="inner"><h4>Только для вас</h4><p>${esc(c.sec)}</p>${img}</div>
        ${isOpen ? `<button class="hidebtn" data-close="${c.id}">Запечатать снова</button>` : `<button class="seal" data-open="${c.id}">Сломать печать</button>`}
      </div>
    </div></article>`;
}

function decisionsHTML() {
  return (view.decisions || []).map(d => {
    if (d.made === true) return `<div class="decision done"><p class="q">${esc(d.q)}</p><p class="state">Вы решили: да</p></div>`;
    if (!d.open) return `<div class="decision done"><p class="q">${esc(d.q)}</p><p class="state">Вы решили: нет</p></div>`;
    const pending = d.made === false ? '<p class="small" style="margin:0 0 8px">Пока вы ответили «нет». Можно передумать до голосования.</p>' : '';
    return `<div class="decision"><p class="q">${esc(d.q)}</p>${pending}
      <dl><dt>Да</dt><dd>${esc(d.yes)}</dd><dt>Нет</dt><dd>${esc(d.no)}</dd></dl>
      <div class="opts"><button class="btn green" data-decide="${d.id}" data-yes="1">Да</button>
      <button class="btn ghost" data-decide="${d.id}" data-yes="0" ${d.made === false ? 'disabled' : ''}>Нет</button></div></div>`;
  }).join('');
}

function cardTabHTML() {
  const v = view;
  const ph = v.phase;
  const cards = v.cards || [];
  let top = '';
  (v.whispers || []).forEach(w => { top += `<div class="banner whisper"><b>Тайное сообщение</b>${esc(w.text)}</div>`; });

  if (ph === 'roles' || ph === 'cast') return roleHTML(true);
  if (ph === 'vote') return top + voteHTML();
  if (['votes', 'verdict', 'epi', 'scores'].includes(ph) && v.result) return resultHTML();
  if (ph === 'votes') return `<div class="msg"><h2>Голоса подсчитаны</h2><p>Смотрите на экран.</p></div>`;

  if (ph === 'r-cards') {
    if (v.speakerKey === key) top += `<div class="banner turn"><b>Ваша очередь рассказывать</b>Перескажите своими словами часть «Расскажите всем». Тайную — по желанию.<button class="btn" data-act="told">Я закончил рассказ</button></div>`;
    else if (v.told) top += `<div class="banner info">Вы уже рассказали. Слушайте остальных.</div>`;
  }
  const decs = decisionsHTML();
  if (!cards.length) {
    const wait = { prologue: 'Смотрите на экран: начинается история.', inspect: 'Откройте вкладку «Осмотр» и изучите место преступления.', 'r-intro': 'Слушайте вступление на экране.' };
    return top + `<div class="msg"><h2>${ph === 'inspect' ? 'Осмотр' : 'Смотрите на экран'}</h2><p>${wait[ph] || 'Скоро здесь появится ваша первая карточка.'}</p>
      ${ph === 'inspect' ? '<button class="btn" data-tab="zones">Открыть осмотр</button>' : ''}</div>`;
  }
  const latest = cards[cards.length - 1];
  const past = cards.slice(0, -1).reverse();
  let hint = '';
  if (ph === 'r-intro') hint = `<div class="banner info">Слушайте вступление на экране. Новая карточка появится, когда начнутся рассказы.</div>`;
  if (ph === 'm-intro') hint = `<div class="banner info">Полночь. Через минуту откроется последняя карточка.</div>`;
  const body = latest.final !== undefined ? envHTML(latest) + decs : decs + envHTML(latest);
  return top + hint + body +
    (past.length ? `<details class="past"><summary>Прошлые карточки (${past.length})</summary>${past.map(c => envHTML(c)).join('')}</details>` : '');
}

function zonesHTML() {
  const zs = view.zones || [];
  if (!zs.length) return `<div class="msg"><h2>Пока закрыто</h2><p>Место преступления откроется после пролога.</p></div>`;
  if (!zoneSel || !zs.some(z => z.id === zoneSel)) zoneSel = zs[0].id;
  const z = zs.find(zz => zz.id === zoneSel);
  const chips = zs.map(zz => {
    const left = zz.items.filter(it => !seen[zz.id + '.' + it.id + (it.img || '')]).length;
    return `<button aria-pressed="${zz.id === zoneSel}" data-zone="${zz.id}">${esc(zz.name)}${left ? ` · ${left}` : ' ✓'}</button>`;
  }).join('');
  const hots = z.items.map(it => {
    const s = seen[z.id + '.' + it.id + (it.img || '')];
    const size = it.r * 2;
    return `<button class="hot ${s ? 'seen' : ''}" style="left:${it.x}%;top:${it.y}%;width:${size}%;aspect-ratio:1" data-item="${it.id}" aria-label="${esc(it.name)}"></button>`;
  }).join('');
  return `<div class="chips" role="group" aria-label="Места">${chips}</div>
    <div class="scene"><img src="${IMG(z.img)}" alt="${esc(z.name)}">${hots}</div>
    <p class="scene-hint">Нажимайте на светящиеся круги. Предметы видят все игроки — обсуждайте находки вслух.</p>`;
}

function voteHTML() {
  const V = view.vote;
  const mine = V.mine || {};
  const d = { suspect: voteDraft.suspect ?? mine.suspect, method: voteDraft.method ?? mine.method, motive: voteDraft.motive ?? mine.motive };
  const opt = (nameAttr, val, label, sub) => `<label class="opt"><input type="radio" name="${nameAttr}" value="${esc(val)}" ${d[nameAttr] === val ? 'checked' : ''}><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></label>`;
  const ready = d.suspect && d.method && d.motive;
  return `<form class="vote" id="voteform"><h2>Ваш голос</h2>
    <p class="small" style="margin:0 0 16px">Голосуют тайно. Проголосовали ${V.done} из ${view.count}. Голос можно изменить, пока экран не перешёл дальше.</p>
    ${mine.suspect ? '<div class="banner">Голос принят. Можно изменить.</div>' : ''}
    <fieldset><legend>Кто виновен?</legend>${V.suspects.map(s => opt('suspect', s.key, s.roleName, s.name)).join('')}</fieldset>
    <fieldset><legend>Чем убили?</legend>${V.methods.map(m => opt('method', m.id, m.label)).join('')}</fieldset>
    <fieldset><legend>Какой мотив?</legend>${V.motives.map(m => opt('motive', m.id, m.label)).join('')}</fieldset>
    <button class="btn" type="submit" ${ready ? '' : 'disabled'}>${mine.suspect ? 'Изменить голос' : 'Отдать голос'}</button></form>`;
}

function resultHTML() {
  const r = view.result;
  const me = r.me;
  if (!r.showScores) {
    return `<div class="result"><h2>${r.solved ? 'Дело раскрыто!' : 'Дело не раскрыто'}</h2>
      <p>Виновный — ${esc(r.killerName)}.</p><p class="small">Смотрите на экран: там эпилог и разгадка.</p></div>`;
  }
  return `<div class="result"><p class="small">${r.solved ? 'Дело раскрыто' : 'Дело не раскрыто'}. Виновный — ${esc(r.killerName)}.</p>
    <h2>${r.winner ? 'Вы победили!' : `Ваше место: ${r.place}`}</h2>
    <div class="pts">${me.total}</div><div class="small">очков</div>
    <ul>${me.lines.map(l => `<li><span>${esc(l.label)}</span><b>${l.pts > 0 ? '+' : ''}${l.pts}</b></li>`).join('') || '<li><span>Очков нет</span><b>0</b></li>'}</ul>
    <p class="small">Спасибо за игру! С Хэллоуином.</p></div>`;
}

// ---------- Нижние листы ----------
function renderSheet() {
  const el = $('#sheet');
  if (!sheet) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  let inner = '';
  if (sheet.type === 'item') {
    const z = (view.zones || []).find(zz => zz.id === sheet.zone);
    const it = z && z.items.find(i => i.id === sheet.item);
    if (!it) { sheet = null; el.hidden = true; return; }
    inner = `<h3>${esc(it.name)}</h3>
      ${it.img ? `<div class="evimg note-wrap"><img src="${IMG(it.img)}" alt="">${it.note ? `<div class="note-text">${esc(it.note)}</div>` : ''}</div>` : ''}
      <p style="font-size:18px">${esc(it.text)}</p>
      <button class="btn" data-act="closesheet" style="width:100%;margin-top:10px">Понятно</button>`;
  } else if (sheet.type === 'confirm') {
    const d = (view.decisions || []).find(x => x.id === sheet.d);
    inner = `<h3>${sheet.yes ? 'Точно «да»?' : 'Ответить «нет»?'}</h3><p>${esc(d ? (sheet.yes ? d.yes : d.no) : '')}</p>
      <p class="small">${sheet.yes ? 'Это решение нельзя отменить.' : ''}</p>
      <div class="row"><button class="btn ghost" data-act="closesheet">Отмена</button>
      <button class="btn ${sheet.yes ? 'green' : ''}" data-act="confirm">${sheet.yes ? 'Да, решено' : 'Нет'}</button></div>`;
  } else if (sheet.type === 'remote') {
    inner = `<h3>Пульт</h3><p class="small">Листайте экран игры отсюда, если до ноутбука далеко.</p>
      <div class="remote"><button class="btn" data-act="rnext">Далее на экране</button>
      ${view.timer != null ? '<button class="btn ghost" data-act="rpause">Пауза или продолжить таймер</button>' : ''}
      <button class="btn ghost" data-act="closesheet">Закрыть</button></div>`;
  }
  el.innerHTML = `<div class="sheet-back" data-act="closeback"><div class="sheet parch" role="dialog">${inner}</div></div>`;
}

let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- События ----------
document.addEventListener('submit', e => {
  e.preventDefault();
  audio.unlock();
  if (e.target.id === 'joinform') {
    const r = $('#room');
    if (r) {
      room = r.value.toUpperCase().replace(/[^A-Z]/g, '');
      if (room.length !== 5) { toast('Код комнаты — пять латинских букв с экрана.'); return; }
      const u = new URL(location.href); u.searchParams.set('room', room); history.replaceState(null, '', u);
    }
    name = $('#name').value.trim().slice(0, 20);
    if (!name) return;
    store.set('name', name);
    if (net) send({ t: 'join', key, name }); else connect();
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

document.addEventListener('change', e => {
  if (e.target.closest('#voteform')) {
    voteDraft[e.target.name] = e.target.value;
    const f = $('#voteform');
    const b = f.querySelector('button[type=submit]');
    const fd = new FormData(f);
    b.disabled = !(fd.get('suspect') && fd.get('method') && fd.get('motive'));
  }
});

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act],[data-tab],[data-open],[data-close],[data-zone],[data-item],[data-decide],[data-seat]');
  if (!t) return;
  audio.unlock();
  const ds = t.dataset;
  if (ds.tab) { tab = ds.tab; newTabs[tab] = false; render(); window.scrollTo(0, 0); return; }
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
  if (ds.seat) { send({ t: 'reclaim', seat: ds.seat, key }); return; }
  switch (ds.act) {
    case 'told': send({ t: 'told' }); buzz(40); break;
    case 'cover': covered = true; render(); break;
    case 'uncover': covered = false; render(); break;
    case 'remote': sheet = { type: 'remote' }; renderSheet(); break;
    case 'rnext': send({ t: 'next' }); buzz(30); break;
    case 'rpause': send({ t: 'pause' }); break;
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

if (room && name) connect();
render();
