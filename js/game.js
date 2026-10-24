// Логика игры без интерфейса: шаги, роли, решения, голосование, очки.
// В игре всегда все пять персонажей. Роли без игрока читает и разыгрывает ведущий.
import {
  ROLE_IDS, ROLES, GUILTY, CAST, PROLOGUE, ZONES, ROUNDS, MIDNIGHT,
  DECISIONS, VOTE, EPILOGUE, TIMERS,
} from './content.js';

export const MAX_PLAYERS = 5;
const KEY_ROLES = ['butler', 'captain', 'cook'];
const EXTRA_ROLES = ['agata', 'toby'];

// ---------- Шаги ----------
export function buildSteps() {
  const s = [];
  s.push({ id: 'lobby' });
  s.push({ id: 'roles' });
  for (let i = 0; i < CAST.length + ROLE_IDS.length; i++) s.push({ id: 'cast', i });
  PROLOGUE.forEach((_, i) => s.push({ id: 'prologue', i }));
  s.push({ id: 'inspect', zones: ['deck', 'cabin'], timer: TIMERS.inspect });
  for (const r of ROUNDS) {
    s.push({ id: 'r-intro', r: r.n });
    s.push({ id: 'r-cards', r: r.n });
    const z = ZONES.find(zz => zz.unlock === 'round' + r.n);
    if (z) s.push({ id: 'inspect', r: r.n, zone: z.id, timer: TIMERS.inspectRound });
    s.push({ id: 'r-discuss', r: r.n, timer: TIMERS.discuss });
  }
  s.push({ id: 'm-intro' });
  s.push({ id: 'm-cards' });
  s.push({ id: 'inspect', m: true, zone: 'galley', timer: TIMERS.inspectRound });
  s.push({ id: 'm-discuss', timer: TIMERS.midnightDiscuss });
  s.push({ id: 'vote', timer: TIMERS.vote });
  s.push({ id: 'votes' });
  s.push({ id: 'verdict' });
  EPILOGUE.forEach((_, i) => s.push({ id: 'epi', i }));
  s.push({ id: 'scores' });
  return s;
}
const STEPS = buildSteps();
export function steps() { return STEPS; }
export function cur(state) { return STEPS[state.step]; }
export function idxOf(id, extra = {}) {
  return STEPS.findIndex(s => s.id === id && Object.entries(extra).every(([k, v]) => s[k] === v));
}

// ---------- Состояние ----------
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newCode() {
  let c = '';
  for (let i = 0; i < 5; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return c;
}

export function newState(extra = {}) {
  return {
    v: 2,
    code: newCode(),
    players: [],      // {key, name, role}
    gmKey: null,      // телефон ведущего
    step: 0,
    speaker: 0,
    told: {},         // role -> true в текущем шаге рассказов
    decisions: {},
    votes: {},        // key -> {suspect: role, method, motive}
    timer: null,
    rev: 1,
    created: Date.now(),
    ...extra,
  };
}

export function owner(state, role) { return state.players.find(p => p.role === role) || null; }
export function npcRoles(state) { return ROLE_IDS.filter(r => !owner(state, r)); }
export function isGM(state, key) { return key === 'tv' || (!!state.gmKey && key === state.gmKey); }

// может ли этот участник действовать за роль
export function canActFor(state, key, role) {
  const p = state.players.find(pp => pp.key === key);
  if (p) return p.role === role;
  return isGM(state, key) && !owner(state, role);
}

// ---------- Игроки ----------
export function addPlayer(state, key, name) {
  const ex = state.players.find(p => p.key === key);
  if (ex) { if (name && state.step === 0) ex.name = clean(name); return { ok: true, player: ex, rejoined: true }; }
  if (state.step > 0) return { ok: false, reason: 'started' };
  if (state.players.length >= MAX_PLAYERS) return { ok: false, reason: 'full' };
  const p = { key, name: clean(name), role: null };
  state.players.push(p);
  return { ok: true, player: p };
}
const clean = n => String(n || '').trim().slice(0, 20) || 'Гость';

export function removePlayer(state, key) {
  if (state.step > 0) return false;
  state.players = state.players.filter(p => p.key !== key);
  return true;
}

export function reclaimSeat(state, oldKey, newKey) {
  const p = state.players.find(pp => pp.key === oldKey);
  if (!p) return null;
  if (state.votes[oldKey]) { state.votes[newKey] = state.votes[oldKey]; delete state.votes[oldKey]; }
  p.key = newKey;
  return p;
}

function shuffle(a, rnd = Math.random) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Сначала игрокам достаются главные роли, затем дополнительные.
export function dealRoles(state, rnd = Math.random) {
  const order = shuffle(KEY_ROLES, rnd).concat(shuffle(EXTRA_ROLES, rnd));
  shuffle(state.players, rnd).forEach((p, i) => { p.role = order[i]; });
}

// ---------- Переходы ----------
export function canAdvance(state) {
  if (cur(state).id === 'lobby') return state.players.length >= 1;
  return state.step < STEPS.length - 1;
}
export function canBack(state) { return state.step > 1; }

export function go(state, delta) {
  const next = Math.max(0, Math.min(STEPS.length - 1, state.step + delta));
  if (next === state.step || next === 0) return false;
  if (state.step === 0) {
    if (state.players.length < 1) return false;
    dealRoles(state);
  }
  state.step = next;
  state.speaker = 0;
  state.told = {};
  const s = STEPS[next];
  state.timer = s.timer ? { total: s.timer, endsAt: Date.now() + s.timer * 1000, left: s.timer * 1000 } : null;
  return true;
}

export function speakingOrder(state) {
  const s = cur(state);
  const shift = s.r ? (s.r - 1) % ROLE_IDS.length : 0;
  return ROLE_IDS.map((_, i) => {
    const role = ROLE_IDS[(i + shift) % ROLE_IDS.length];
    const p = owner(state, role);
    return { role, key: p ? p.key : null, name: p ? p.name : 'Ведущий' };
  });
}
export function currentSpeaker(state) {
  if (cur(state).id !== 'r-cards') return null;
  return speakingOrder(state)[state.speaker] || null;
}
export function nextSpeaker(state) {
  if (state.speaker < ROLE_IDS.length) state.speaker++;
}
export function markTold(state, key) {
  const sp = currentSpeaker(state);
  if (!sp) return false;
  if (!canActFor(state, key, sp.role)) return false;
  state.told[sp.role] = true;
  nextSpeaker(state);
  return true;
}

// ---------- Зоны ----------
export function zonesOpen(state) {
  const i = state.step;
  const open = [];
  for (const z of ZONES) {
    let ok = false;
    if (z.unlock === 'prologue') ok = i >= idxOf('inspect');
    else {
      const at = STEPS.findIndex(s => s.id === 'inspect' && s.zone === z.id);
      ok = i >= at || (z.id === 'hold' && state.decisions.D1 === true);
    }
    if (ok) open.push(z.id);
  }
  return open;
}

export function zoneView(state, zid) {
  const z = ZONES.find(zz => zz.id === zid);
  const noJar = state.decisions.D5 === true;
  return {
    id: z.id,
    name: z.name,
    img: noJar && z.imgNoJar ? z.imgNoJar : z.img,
    items: z.items.map(it => {
      const v = noJar && it.noJar ? { ...it, ...it.noJar } : it;
      return { id: v.id, name: v.name, x: v.x, y: v.y, r: v.r, text: v.text, img: v.img || null, note: v.note || null, sfx: v.sfx || null };
    }),
  };
}

// ---------- Решения ----------
export function decisionOpen(state, d) {
  const D = DECISIONS[d];
  if (state.decisions[d] === true) return false;
  if (state.decisions[d] === false && !D.retry) return false;
  const start = D.from === 'midnight' ? idxOf('m-cards') : idxOf('r-cards', { r: D.from });
  const end = D.until ? idxOf(D.until) : idxOf('vote');
  return state.step >= start && state.step <= end;
}

export function decide(state, key, d, yes) {
  const D = DECISIONS[d];
  if (!D || !canActFor(state, key, D.role) || !decisionOpen(state, d)) return { ok: false };
  state.decisions[d] = !!yes;
  return { ok: true, reveal: yes && D.reveal ? d : null };
}

function decisionsForRole(state, role) {
  return Object.entries(DECISIONS)
    .filter(([, D]) => D.role === role)
    .map(([d, D]) => ({ id: d, role, q: D.q, yes: D.yes, no: D.no, open: decisionOpen(state, d), made: state.decisions[d] }))
    .filter(x => x.open || x.made !== undefined);
}

export function whispersFor(state, role) {
  const w = [];
  for (const [d, D] of Object.entries(DECISIONS)) {
    if (D.whisper && D.whisper.role === role && state.decisions[d] === true) w.push({ d, text: D.whisper.text });
  }
  return w;
}

// ---------- Голосование ----------
export function castVote(state, key, vote) {
  const p = state.players.find(pp => pp.key === key);
  if (!p || state.step !== idxOf('vote')) return false;
  if (!vote || !ROLE_IDS.includes(vote.suspect) || vote.suspect === p.role) return false;
  if (!VOTE.methods.some(m => m.id === vote.method)) return false;
  if (!VOTE.motives.some(m => m.id === vote.motive)) return false;
  state.votes[key] = { suspect: vote.suspect, method: vote.method, motive: vote.motive };
  return true;
}

export function results(state) {
  const tally = {};
  ROLE_IDS.forEach(r => { tally[r] = 0; });
  for (const p of state.players) { const v = state.votes[p.key]; if (v) tally[v.suspect]++; }
  const detectives = state.players.filter(p => p.role !== GUILTY);
  const max = Math.max(...Object.values(tally));
  const leaders = ROLE_IDS.filter(r => tally[r] === max);
  const solved = max > 0 && leaders.length === 1 && leaders[0] === GUILTY
    && tally[GUILTY] >= Math.ceil(Math.max(1, detectives.length) / 2);
  const D = state.decisions;
  const scores = state.players.map(p => {
    const lines = [];
    const add = (label, pts) => lines.push({ label, pts });
    const v = state.votes[p.key];
    if (p.role !== GUILTY) {
      if (v && v.suspect === GUILTY) add('Голос за виновного', 3);
      if (v && v.method === VOTE.answer.method) add('Верно назван способ', 1);
      if (v && v.motive === VOTE.answer.motive) add('Верно назван мотив', 1);
      if (solved) add('Дело раскрыто', 1);
    } else {
      if (!solved) add('Дело не раскрыто', 5);
      if (!solved && D.D5 === true) add('Банка за бортом', 1);
    }
    if (p.role === 'butler' && D.D1 === true && solved) add('Раскрылся как следователь', 1);
    if (p.role === 'captain' && D.D2 === true && solved) add('Показал леску', 1);
    if (p.role === 'agata' && D.D4 === true && solved) add('Включила запись', 1);
    if (p.role === 'toby') {
      if (D.D3 === true) add('Отдал компас', 1);
      else if (tally.toby === 0) add('Компас не нашли', 2);
      else add('Компас нашли при обыске', -1);
    }
    const total = lines.reduce((a, l) => a + l.pts, 0);
    return { key: p.key, name: p.name, role: p.role, total, lines, votedKiller: !!(v && v.suspect === GUILTY) };
  });
  scores.sort((a, b) => b.total - a.total);
  const top = scores.length ? scores[0].total : 0;
  let winners = scores.filter(s => s.total === top);
  if (winners.length > 1 && winners.some(w => w.votedKiller)) winners = winners.filter(w => w.votedKiller);
  return { tally, solved, scores, winners: winners.map(w => w.key), voters: Object.keys(state.votes).length };
}

// ---------- Карточки ----------
export function cardsFor(state, role) {
  const out = [];
  for (const r of ROUNDS) {
    if (state.step >= idxOf('r-cards', { r: r.n })) {
      const c = r.cards[role];
      out.push({ id: 'r' + r.n, title: `Раунд ${r.n}. ${r.title}`, time: r.time, pub: c.pub, sec: c.sec, img: c.img || null, note: c.note || null });
    }
  }
  if (state.step >= idxOf('m-cards')) {
    const c = MIDNIGHT.cards[role];
    out.push({ id: 'm', title: 'Полночь', time: '00:00', final: c.text, guilty: !!c.guilty });
  }
  return out;
}

function roleInfo(role) {
  const R = ROLES[role];
  return { role, roleName: R.name, roleTitle: R.title, portrait: R.portrait, desc: R.desc };
}

// ---------- Текст шага (ТВ справа и телефон ведущего) ----------
export function narrative(state) {
  const s = cur(state);
  const who = role => { const p = owner(state, role); return p ? `Играет ${p.name}` : 'Читает ведущий'; };
  switch (s.id) {
    case 'lobby': return { title: 'Поднимайтесь на борт', text: 'Игроки наводят камеру телефона на QR-код и вводят имя. Играть можно из любой сети и даже из другого города — ссылку можно переслать в мессенджере.', hint: 'Сколько бы игроков ни пришло, в игре будут все пять персонажей: свободные роли читает ведущий.' };
    case 'roles': return { title: 'Роли розданы', text: 'Посмотрите в телефон, кем вы будете этой ночью. Никому не показывайте экран.' };
    case 'cast': {
      if (s.i < CAST.length) { const c = CAST[s.i]; return { kicker: c.tag, title: c.name, text: c.text }; }
      const role = ROLE_IDS[s.i - CAST.length];
      const R = ROLES[role];
      return { kicker: `${R.key ? 'Главная роль' : 'Дополнительная роль'} · ${who(role)}`, title: R.name, text: R.desc, hint: owner(state, role) ? 'Игрок читает описание вслух.' : 'Ведущий читает описание вслух.' };
    }
    case 'prologue': {
      const P = PROLOGUE[s.i];
      return { kicker: 'Пролог', title: P.title || '', text: P.text || '', list: P.list || null, big: !!P.big };
    }
    case 'inspect': {
      if (!s.zone) return { kicker: 'Улики', title: 'Осмотр места преступления', text: 'Откройте вкладку «Осмотр» в телефоне и обыщите палубу и капитанскую каюту. Нажимайте на всё, что кажется подозрительным. Новые места будут открываться по ходу вечера.' };
      const Z = ZONES.find(z => z.id === s.zone);
      return {
        kicker: s.m ? 'Полночь · осмотр' : `Раунд ${s.r} · осмотр`,
        title: `Открыто новое место: ${Z.name}`,
        text: `Откройте вкладку «Осмотр» в телефоне и обыщите ${Z.acc || Z.name.toLowerCase()}. После осмотра — обсуждение.`,
        hint: 'Можно заново осматривать и прежние места.',
      };
    }
    case 'r-intro': { const R = ROUNDS[s.r - 1]; return { kicker: `Раунд ${R.n} из 5 · ${R.time}`, title: R.title, text: R.intro }; }
    case 'r-cards': {
      const R = ROUNDS[s.r - 1];
      const sp = currentSpeaker(state);
      return {
        kicker: `Раунд ${R.n} · ${R.time}`, title: R.title,
        text: 'Каждый молча читает свою карточку в телефоне. Затем по очереди рассказываем часть «Расскажите всем». Тайную часть — по желанию.',
        hint: sp ? `Сейчас рассказывает: ${ROLES[sp.role].name} (${sp.key ? sp.name : 'ведущий'}).` : 'Все рассказали. Переходим к обсуждению.',
      };
    }
    case 'r-discuss': { const R = ROUNDS[s.r - 1]; return { kicker: `Раунд ${R.n} · ${R.title}`, title: 'Обсуждение', text: 'Кто где был? Что не сходится? Записывайте подозрения в «Пометки».', hint: s.r >= 4 ? 'Если в телефоне появилось решение — его можно принять в любой момент до голосования.' : '' }; }
    case 'm-intro': return { kicker: '00:00', title: 'Полночь', text: MIDNIGHT.intro, big: true };
    case 'm-cards': return { kicker: '00:00', title: 'Полночь', text: 'Читайте последнюю карточку молча. С этой минуты виновному разрешено лгать. Остальные говорят правду.' };
    case 'm-discuss': return { kicker: 'Финал', title: 'Последнее обсуждение', text: 'Открыт камбуз. Сопоставьте всё, что знаете. После этого — голосование.' };
    case 'vote': return { kicker: 'Финал', title: 'Кто погубил Сайласа Корвина?', text: 'Голосуйте в телефоне: кто виновен, чем убили и зачем. За своего персонажа голосовать нельзя.', hint: `Проголосовали ${Object.keys(state.votes).length} из ${state.players.length}.` };
    case 'votes': return { kicker: 'Финал', title: 'Голоса', text: 'Сейчас узнаем, раскрыто ли дело.' };
    case 'verdict': {
      const res = results(state);
      const k = owner(state, GUILTY);
      const by = k ? `В этой роли — ${k.name}.` : 'Эту роль читал ведущий.';
      return res.solved
        ? { kicker: 'Вердикт', title: 'Дело раскрыто!', text: `Виновный — ${ROLES[GUILTY].name}. ${by} На рассвете береговая охрана поднимается на борт.` }
        : { kicker: 'Вердикт', title: 'Дело не раскрыто', text: `Призрак смеётся последним. Виновный — ${ROLES[GUILTY].name}. ${by}` };
    }
    case 'epi': { const E = EPILOGUE[s.i]; return { kicker: 'Эпилог', title: E.title || '', text: E.text || '', list: E.list || null, big: !!E.big }; }
    case 'scores': {
      const res = results(state);
      const w = res.scores.filter(x => res.winners.includes(x.key)).map(x => x.name).join(', ');
      return { kicker: 'Итоги', title: w ? `Победитель: ${w}` : 'Итоги', text: 'Спасибо за игру! С Хэллоуином.' };
    }
    default: return { title: s.id };
  }
}

export function stepLabel(state) {
  const s = cur(state);
  const L = {
    lobby: 'Сбор гостей', roles: 'Раздача ролей', cast: 'Знакомство', prologue: 'Пролог', inspect: s.zone ? (s.m ? 'Полночь: осмотр' : `Раунд ${s.r}: осмотр`) : 'Осмотр',
    'r-intro': `Раунд ${s.r}: вступление`, 'r-cards': `Раунд ${s.r}: рассказы`, 'r-discuss': `Раунд ${s.r}: обсуждение`,
    'm-intro': 'Полночь', 'm-cards': 'Полночь: карточки', 'm-discuss': 'Полночь: обсуждение',
    vote: 'Голосование', votes: 'Голоса', verdict: 'Вердикт', epi: 'Эпилог', scores: 'Итоги',
  };
  return L[s.id] || s.id;
}

// ---------- Вид для телефона игрока ----------
export function viewFor(state, key) {
  const p = state.players.find(pp => pp.key === key);
  const s = cur(state);
  const v = {
    rev: state.rev,
    code: state.code,
    step: state.step,
    phase: s.id,
    r: s.r || null,
    focusZone: s.zone || null,
    label: stepLabel(state),
    players: state.players.map(pp => ({ name: pp.name })),
    timer: state.timer ? timerLeft(state.timer) : null,
    timerRunning: !!(state.timer && state.timer.endsAt),
  };
  if (!p) return v;
  v.me = { key: p.key, name: p.name };
  if (!p.role) return v;
  Object.assign(v.me, roleInfo(p.role));
  v.cards = cardsFor(state, p.role);
  v.zones = zonesOpen(state).map(z => zoneView(state, z));
  v.decisions = decisionsForRole(state, p.role);
  v.whispers = whispersFor(state, p.role);
  const sp = currentSpeaker(state);
  if (s.id === 'r-cards') { v.myTurn = !!(sp && sp.key === p.key); v.told = !!state.told[p.role]; }
  if (s.id === 'vote') {
    v.vote = {
      suspects: ROLE_IDS.filter(r => r !== p.role).map(r => ({ role: r, roleName: ROLES[r].name, who: owner(state, r) ? owner(state, r).name : 'ведущий' })),
      methods: VOTE.methods, motives: VOTE.motives,
      mine: state.votes[p.key] || null,
      done: Object.keys(state.votes).length, of: state.players.length,
    };
  }
  if (state.step >= idxOf('verdict')) {
    const res = results(state);
    v.result = {
      solved: res.solved, killerName: ROLES[GUILTY].name,
      me: res.scores.find(x => x.key === p.key),
      place: res.scores.findIndex(x => x.key === p.key) + 1,
      winner: res.winners.includes(p.key),
      showScores: s.id === 'scores',
    };
  }
  return v;
}

// ---------- Вид для телефона ведущего ----------
export function viewForGM(state, online = () => false) {
  const s = cur(state);
  const sp = currentSpeaker(state);
  const v = {
    rev: state.rev,
    gm: true,
    code: state.code,
    step: state.step,
    total: STEPS.length,
    phase: s.id,
    r: s.r || null,
    label: stepLabel(state),
    narrative: narrative(state),
    canNext: canAdvance(state),
    canBack: canBack(state),
    timer: state.timer ? timerLeft(state.timer) : null,
    timerRunning: !!(state.timer && state.timer.endsAt),
    players: state.players.map(p => ({ key: p.key, name: p.name, roleName: p.role ? ROLES[p.role].name : null, online: online(p.key) })),
    speaker: sp ? { role: sp.role, roleName: ROLES[sp.role].name, name: sp.name, npc: !sp.key } : null,
    npc: state.step > 0 ? npcRoles(state).map(role => ({
      ...roleInfo(role),
      cards: cardsFor(state, role),
      decisions: decisionsForRole(state, role),
      whispers: whispersFor(state, role),
    })) : [],
  };
  if (s.id === 'vote') v.votes = { done: Object.keys(state.votes).length, of: state.players.length };
  if (state.step >= idxOf('votes')) {
    const res = results(state);
    v.results = { solved: res.solved, tally: ROLE_IDS.map(r => ({ roleName: ROLES[r].name, n: res.tally[r] })), scores: res.scores.map(x => ({ name: x.name, roleName: ROLES[x.role].name, total: x.total })) };
  }
  return v;
}

export function timerLeft(t) {
  if (!t) return null;
  return t.endsAt ? Math.max(0, t.endsAt - Date.now()) : Math.max(0, t.left);
}
export function timerPause(state) {
  const t = state.timer;
  if (!t) return;
  if (t.endsAt) { t.left = Math.max(0, t.endsAt - Date.now()); t.endsAt = null; } else t.endsAt = Date.now() + t.left;
}
export function timerAdd(state, sec) {
  const t = state.timer;
  if (!t) return;
  if (t.endsAt) t.endsAt = Math.max(Date.now(), t.endsAt) + sec * 1000; else t.left = Math.max(0, t.left) + sec * 1000;
}
