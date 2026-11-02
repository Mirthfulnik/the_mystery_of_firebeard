// Телефон ведущего: пульт, текст каждого шага, свободные роли, игроки.
import { Channel, queryKeep } from './net.js';
import { esc, IMG, FACE, fmt, store, hashParams, envHTML, decisionHTML, confirmHTML, evImgHTML, buzz, toast } from './ui.js';

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
let zoneSel = null;
let lastFound = -1;
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
    const foundN = (view.zones || []).reduce((a, z) => a + z.items.filter(it => it.found.length).length, 0);
    if (lastFound >= 0 && foundN > lastFound) newTabs.zones = true;
    lastFound = foundN;
    if (prev && prev.phase !== 'inspect' && view.phase === 'inspect' && view.focusZone) zoneSel = view.focusZone;
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
  const zs = view.zones || [];
  const all = zs.reduce((a, z) => a + z.items.length, 0);
  const got = zs.reduce((a, z) => a + z.items.filter(it => it.found.length).length, 0);
  const T = [['text', '☰', 'Текст'], ['npc', '☠', `Роли ведущего${npcN ? ' · ' + npcN : ''}`], ['zones', '⌕', `Осмотр${zs.length ? ` · ${got}/${all}` : ''}`], ['players', '☺', 'Игроки']];
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
    else if (tab === 'zones') m.innerHTML = zonesHTML();
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
  if (v.phase === 'roles') extra = briefingHTML();
  if (v.phase === 'host') extra = introHTML();
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
  const first = (v.speaker && v.speaker.npc) || v.phase === 'roles' || v.phase === 'host' ? extra : '';
  if (first) extra = '';
  return `${first}<article class="script">
    ${N.kicker ? `<div class="kicker">${esc(N.kicker)}</div>` : ''}
    ${N.title ? `<h1>${esc(N.title)}</h1>` : ''}
    <div class="read ${N.big ? 'big' : ''}">${body}</div>
    ${N.hint ? `<p class="hint">${esc(N.hint)}</p>` : ''}
  </article>${extra}
  <p class="small step">Шаг ${v.step + 1} из ${v.total}</p>`;
}

// Памятка: что делает ведущий. Показывается, пока игроки читают свои роли.
function briefingHTML() {
  const npc = (view.npc || []).map(r => r.roleName);
  return `<div class="banner turn"><b>Пока все читают свои роли — прочитайте свою</b>Вы — ведущий: рассказчик и пульт этой игры.</div>
    <div class="parch memo"><h2>Памятка ведущего</h2><ol>
      <li><b>Читайте вслух</b> текст в рамке на вкладке «Текст» — он же справа на экране. Прочитали — нажмите «Далее».</li>
      <li><b>Свободные роли — ваши.</b> ${npc.length ? `Сегодня вы играете: ${npc.map(esc).join(', ')}. Их описания, карточки и решения — на вкладке «Роли ведущего».` : 'Сегодня все роли у игроков — читать за персонажей не нужно.'}</li>
      <li><b>Держите темп.</b> В рассказах следите за очередью, в обсуждениях — за таймером: «Пауза» и «+1 мин» внизу.</li>
      <li><b>Осмотр.</b> На вкладке «Осмотр» видно, какие улики игроки уже нашли, а какие нет. Если важное никто не нашёл — можно подсказать, куда посмотреть, но не что там.</li>
      <li><b>Не выдавайте разгадку.</b> Кто виновен, не подсказывайте. Если виновный окажется среди ваших ролей — держите лицо.</li>
      <li><b>Дальше — ваш выход.</b> На следующем шаге представьтесь гостям.</li>
    </ol></div>`;
}

// Шаг «Ведущий вечера»: что сказать, представляясь
function introHTML() {
  const npc = (view.npc || []).map(r => r.roleName);
  return `<div class="banner turn"><b>Представьтесь — скажите вслух</b>Своими словами или так:</div>
    <div class="parch memo"><p class="say">«Добрый вечер, гости „Мелюзины“! Меня зовут <u>&nbsp;ваше имя&nbsp;</u>, и этой ночью я ваш ведущий. Я буду рассказывать историю и следить за временем${npc.length ? `, а ещё говорить за тех, кому не хватило игроков: ${npc.map(esc).join(', ')}` : ''}. Кто виновен, я не подскажу — разбираться вам. Итак, знакомьтесь…»</p></div>`;
}

// Места преступления: что игроки уже нашли, а что нет
function zonesHTML() {
  const zs = view.zones || [];
  if (!zs.length) return `<div class="msg"><h2>Пока закрыто</h2><p>Места преступления откроются после пролога. Здесь будет видно, какие улики игроки уже нашли.</p></div>`;
  if (!zoneSel || !zs.some(z => z.id === zoneSel)) zoneSel = view.focusZone && zs.some(z => z.id === view.focusZone) ? view.focusZone : zs[0].id;
  const z = zs.find(zz => zz.id === zoneSel);
  const chips = zs.map(zz => {
    const n = zz.items.filter(it => it.found.length).length;
    return `<button aria-pressed="${zz.id === zoneSel}" data-zone="${zz.id}">${esc(zz.name)} · ${n}/${zz.items.length}</button>`;
  }).join('');
  const hots = z.items.map((it, i) => `<span class="gmhot ${it.found.length ? 'found' : 'missed'}" style="left:${it.x}%;top:${it.y}%;width:${it.r * 2}%">${i + 1}</span>`).join('');
  const found = z.items.filter(it => it.found.length).length;
  const list = z.items.map((it, i) => `<details class="gmitem ${it.found.length ? 'found' : 'missed'}"><summary><span class="n">${i + 1}</span><span class="t"><b>${esc(it.name)}</b>
      <small>${it.found.length ? 'Нашли: ' + it.found.map(esc).join(', ') : 'Пока никто не нашёл'}</small></span></summary>
      ${it.img ? evImgHTML(it.img, it.note) : ''}<p>${esc(it.text)}</p></details>`).join('');
  return `<div class="chips" role="group" aria-label="Места">${chips}</div>
    <div class="scene">${'<img src="' + IMG(z.img) + '" alt="' + esc(z.name) + '">'}${hots}</div>
    <p class="scene-hint">${found} из ${z.items.length} найдено. <span class="lg found"></span> нашли &nbsp; <span class="lg missed"></span> не нашли. Нажмите на улику в списке, чтобы прочитать её.</p>
    <div class="gmitems">${list}</div>`;
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
  const t = e.target.closest('[data-ctl],[data-act],[data-tab],[data-npc],[data-zone],[data-open],[data-close],[data-decide],[data-kick]');
  if (!t) return;
  const ds = t.dataset;
  if (ds.ctl) { ctl(ds.ctl); return; }
  if (ds.tab) { tab = ds.tab; render(); window.scrollTo(0, 0); return; }
  if (ds.npc) { npcSel = ds.npc; render(); return; }
  if (ds.zone) { zoneSel = ds.zone; render(); return; }
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
