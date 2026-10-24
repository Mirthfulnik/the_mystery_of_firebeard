// Телефон ведущего: пульт, текст каждого шага, свободные роли, игроки.
import { Channel, queryKeep } from './net.js';
import { esc, IMG, FACE, fmt, store, hashParams, envHTML, decisionHTML, confirmHTML, buzz, toast } from './ui.js';

const $ = s => document.querySelector(s);
const { room, secret, broker, gm } = hashParams();
let key = store.get('gmkey', null);
if (!key) { key = 'gm_' + Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('gmkey', key); }

let ch = null;
let netState = 'off';
let view = null;
let viewAt = 0;
let tab = 'text';
let screen = room && secret && gm ? 'wait' : 'nolink';
let opened = store.get('gmopened', {});
let sheet = null;
let npcSel = null;
let lastDecN = 0;
const newTabs = {};

function connect() {
  ch = new Channel({
    room, secret, broker, mine: key,
    onStatus: s => { netState = s; renderBar(); },
    onConnect: () => send({ t: 'hello', gm }),
    onMsg,
  });
  setInterval(() => send({ t: 'ping', rev: view ? view.rev : 0 }), 5000);
}
function send(m) { if (ch) ch.toHost({ ...m, key }); }
function ctl(a, arg) { send({ t: 'ctl', a, arg }); buzz(25); }

function onMsg(m) {
  if (m.t === 'view') {
    const prev = view;
    view = m.v; viewAt = Date.now(); screen = 'game';
    const decN = (view.npc || []).reduce((a, r) => a + r.decisions.filter(d => d.open && d.made === undefined).length + r.whispers.length, 0);
    if (decN > lastDecN) { newTabs.npc = true; buzz([120, 60, 120]); }
    lastDecN = decN;
    if (prev && prev.step !== view.step) window.scrollTo(0, 0);
    render();
  } else if (m.t === 'denied') { screen = 'denied'; render(); }
  else if (m.t === 'hello?') send({ t: 'hello', gm });
}

function timerLeft() {
  if (!view || view.timer == null) return null;
  return view.timerRunning ? Math.max(0, view.timer - (Date.now() - viewAt)) : view.timer;
}

function renderBar() {
  const el = $('#bar');
  el.hidden = false;
  const left = timerLeft();
  el.innerHTML = `<div class="gmbadge" aria-hidden="true">☠</div>
    <div class="ttl"><b>Ведущий${view ? ' · комната ' + esc(view.code) : ''}</b><span>${view ? esc(view.label) : 'подключение…'}</span></div>
    ${left != null ? `<span class="tmr ${left < 30000 ? 'low' : ''}" id="tmr">${fmt(left)}</span>` : ''}
    <span class="conn ${netState === 'online' ? 'ok' : ''}"></span>`;
}

function renderTabs() {
  const el = $('#tabs');
  if (screen !== 'game') { el.hidden = true; return; }
  el.hidden = false;
  const npcN = (view.npc || []).length;
  const T = [['text', '☰', 'Текст'], ['npc', '☠', `Роли ведущего${npcN ? ' · ' + npcN : ''}`], ['players', '☺', 'Игроки']];
  el.innerHTML = T.map(([id, i, l]) => `<button role="tab" aria-selected="${tab === id}" data-tab="${id}"><span class="i">${i}</span>${l}${newTabs[id] && tab !== id ? '<span class="new"></span>' : ''}</button>`).join('');
}

function renderRemote() {
  const el = $('#remote');
  if (screen !== 'game') { el.hidden = true; return; }
  el.hidden = false;
  const v = view;
  const extra = [];
  if (v.speaker) extra.push(`<button class="btn ghost" data-ctl="speaker">Следующий рассказчик</button>`);
  if (v.timer != null) extra.push(`<button class="btn ghost" data-ctl="pause">${v.timerRunning ? 'Пауза' : 'Продолжить'}</button><button class="btn ghost" data-ctl="plus">+1 мин</button>`);
  el.innerHTML = `${extra.length ? `<div class="extra">${extra.join('')}</div>` : ''}
    <div class="main"><button class="btn ghost" data-ctl="prev" ${v.canBack ? '' : 'disabled'}>Назад</button>
    <button class="btn" data-ctl="next" ${v.canNext ? '' : 'disabled'}>${v.phase === 'lobby' ? 'Раздать роли' : 'Далее'}</button></div>`;
}

function render() {
  renderBar();
  renderTabs();
  renderRemote();
  const m = $('#main');
  if (screen === 'nolink') m.innerHTML = `<div class="msg"><h2>Нужен код ведущего</h2><p>Отсканируйте маленький QR-код «для ведущего» на экране телевизора.</p></div>`;
  else if (screen === 'wait') m.innerHTML = `<div class="msg"><h2>Подключаемся к экрану…</h2><p>Если это длится дольше минуты, проверьте интернет и что игра открыта на телевизоре.</p></div>`;
  else if (screen === 'denied') m.innerHTML = `<div class="msg"><h2>Код устарел</h2><p>Этот код ведущего от другой игры. Отсканируйте код с экрана заново.</p></div>`;
  else {
    if (tab === 'npc') m.innerHTML = npcHTML();
    else if (tab === 'players') m.innerHTML = playersHTML();
    else m.innerHTML = textHTML();
  }
  newTabs[tab] = false;
  renderSheet();
}

function textHTML() {
  const v = view;
  const N = v.narrative;
  const body = N.list ? `<ul>${N.list.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : (N.text ? `<p>${esc(N.text)}</p>` : '');
  let extra = '';
  if (v.phase === 'lobby') {
    extra = `<div class="banner info"><b>Игроки: ${v.players.length}</b>${v.players.map(p => esc(p.name)).join(', ') || 'пока никого'}.<br>Свободные роли из пяти вы будете читать сами.</div>
      <button class="btn green wide" data-act="share">Отправить ссылку игрокам</button>
      <p class="small">Ссылку можно переслать в мессенджер: подключиться можно из любой сети.</p>`;
  }
  if (v.speaker && v.speaker.npc) {
    const npc = (v.npc || []).find(r => r.role === v.speaker.role);
    const card = npc && npc.cards[npc.cards.length - 1];
    extra = `<div class="banner turn"><b>Ваша очередь: читайте за роль «${esc(v.speaker.roleName)}»</b>${card && card.pub ? esc(card.pub) : ''}
      <button class="btn" data-act="told">Прочитал, следующий</button></div>`;
  } else if (v.speaker) {
    extra = `<div class="banner info"><b>Рассказывает ${esc(v.speaker.name)}</b>Роль «${esc(v.speaker.roleName)}». Когда закончит, он нажмёт кнопку у себя — или нажмите «Следующий рассказчик».</div>`;
  }
  if (v.votes) extra = `<div class="banner info"><b>Проголосовали ${v.votes.done} из ${v.votes.of}</b>Когда все проголосуют, нажмите «Далее».</div>`;
  if (v.results) {
    extra = `<div class="banner info"><b>${v.results.solved ? 'Дело раскрыто' : 'Дело не раскрыто'}</b>${v.results.tally.map(t => `${esc(t.roleName)}: ${t.n}`).join('<br>')}</div>`;
    if (v.phase === 'scores') extra += `<div class="banner"><b>Очки</b>${v.results.scores.map(s => `${esc(s.name)} (${esc(s.roleName)}): ${s.total}`).join('<br>')}</div>`;
  }
  const first = v.speaker && v.speaker.npc ? extra : '';
  if (first) extra = '';
  return `${first}<article class="script">
    ${N.kicker ? `<div class="kicker">${esc(N.kicker)}</div>` : ''}
    ${N.title ? `<h1>${esc(N.title)}</h1>` : ''}
    <div class="read ${N.big ? 'big' : ''}">${body}</div>
    ${N.hint ? `<p class="hint">${esc(N.hint)}</p>` : ''}
  </article>${extra}
  <p class="small step">Шаг ${v.step + 1} из ${v.total}</p>`;
}

function npcHTML() {
  const list = view.npc || [];
  if (!list.length) return `<div class="msg"><h2>${view.phase === 'lobby' ? 'Роли ещё не розданы' : 'Все роли у игроков'}</h2><p>${view.phase === 'lobby' ? 'После раздачи здесь появятся персонажи, которых играете вы.' : 'Вам ничего читать за персонажей не нужно.'}</p></div>`;
  if (!npcSel || !list.some(r => r.role === npcSel)) npcSel = list[0].role;
  const r = list.find(x => x.role === npcSel);
  const chips = list.map(x => {
    const alert = x.decisions.some(d => d.open && d.made === undefined) || x.whispers.length;
    return `<button aria-pressed="${x.role === npcSel}" data-npc="${x.role}"><img src="${FACE(x.portrait)}" alt="">${esc(x.roleName.split(' ')[0])}${alert ? ' •' : ''}</button>`;
  }).join('');
  const cards = r.cards;
  const latest = cards[cards.length - 1];
  const past = cards.slice(0, -1).reverse();
  const wh = r.whispers.map(w => `<div class="banner whisper"><b>Тайное сообщение для этой роли</b>${esc(w.text)}</div>`).join('');
  return `<div class="chips npc">${chips}</div>
    <div class="npchead"><img src="${FACE(r.portrait)}" alt=""><div><b>${esc(r.roleName)}</b><span>${esc(r.roleTitle)}</span></div></div>
    ${wh}${r.decisions.map(decisionHTML).join('')}
    ${latest ? envHTML(latest, opened, r.role + '.') : `<div class="parch" style="padding:14px 16px">${esc(r.desc)}</div><p class="small">Карточки появятся в раунде 1.</p>`}
    ${past.length ? `<details class="past"><summary>Прошлые карточки (${past.length})</summary>${past.map(c => envHTML(c, opened, r.role + '.')).join('')}</details>` : ''}`;
}

function playersHTML() {
  const v = view;
  if (!v.players.length) return `<div class="msg"><h2>Игроков пока нет</h2><p>Попросите всех отсканировать большой QR-код на экране.</p></div>`;
  return `<ul class="plist">${v.players.map(p => `<li><span class="conn ${p.online ? 'ok' : ''}"></span><div><b>${esc(p.name)}</b><span>${esc(p.roleName || 'роль ещё не роздана')}</span></div>
    ${v.phase === 'lobby' ? `<button class="ib" data-kick="${esc(p.key)}">Убрать</button>` : ''}</li>`).join('')}</ul>
    <button class="btn ghost wide" data-act="share">Отправить ссылку игрокам</button>
    <p class="small">Если игрок сменил телефон, пусть откроет ту же ссылку и выберет себя в списке.</p>`;
}

function renderSheet() {
  const el = $('#sheet');
  if (!sheet) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const r = (view.npc || []).find(x => x.decisions.some(d => d.id === sheet.d));
  const d = r && r.decisions.find(x => x.id === sheet.d);
  el.innerHTML = `<div class="sheet-back" data-act="closeback"><div class="sheet parch" role="dialog">${confirmHTML(d, sheet.yes)}</div></div>`;
}

function playerLink() {
  const base = new URL('.', location.href).href;
  return `${base}play.html${queryKeep()}#r=${room}&s=${secret}&b=${broker}`;
}

async function share() {
  const url = playerLink();
  try {
    if (navigator.share) { await navigator.share({ title: 'Призрак Огнеборода', text: 'Подключайся к игре:', url }); return; }
    await navigator.clipboard.writeText(url);
    toast('Ссылка скопирована');
  } catch (e) { prompt('Скопируйте ссылку для игроков:', url); }
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-ctl],[data-act],[data-tab],[data-npc],[data-open],[data-close],[data-decide],[data-kick]');
  if (!t) return;
  const ds = t.dataset;
  if (ds.ctl) { ctl(ds.ctl); return; }
  if (ds.tab) { tab = ds.tab; render(); window.scrollTo(0, 0); return; }
  if (ds.npc) { npcSel = ds.npc; render(); return; }
  if (ds.open) { opened[ds.open] = true; store.set('gmopened', opened); render(); return; }
  if (ds.close) { delete opened[ds.close]; store.set('gmopened', opened); render(); return; }
  if (ds.decide) { sheet = { d: ds.decide, yes: ds.yes === '1' }; renderSheet(); return; }
  if (ds.kick) { ctl('kick', ds.kick); return; }
  switch (ds.act) {
    case 'told': send({ t: 'told' }); buzz(30); break;
    case 'share': share(); break;
    case 'confirm': send({ t: 'decide', d: sheet.d, yes: sheet.yes }); sheet = null; renderSheet(); break;
    case 'closesheet': sheet = null; renderSheet(); break;
    case 'closeback': if (e.target === t) { sheet = null; renderSheet(); } break;
    default:
  }
});

setInterval(() => {
  const el = document.getElementById('tmr');
  if (el) { const l = timerLeft(); if (l != null) { el.textContent = fmt(l); el.classList.toggle('low', l < 30000); } }
}, 500);

if (screen === 'wait') connect();
render();
window.__gm = { get view() { return view; } };
