// Логика игры без интерфейса: шаги, решения, голосование, очки.
// Используется экраном ведущего и автотестами.
import {
  ROLES, ROLES_BY_COUNT, GUILTY, CAST, PROLOGUE, ZONES, ROUNDS, MIDNIGHT,
  DECISIONS, VOTE, EPILOGUE, TIMERS,
} from './content.js';

// ---------- Шаги ----------
export function buildSteps(count) {
  const s = [];
  s.push({ id: 'lobby' });
  s.push({ id: 'roles' });
  const castN = CAST.length + ROLES_BY_COUNT[count].length;
  for (let i = 0; i < castN; i++) s.push({ id: 'cast', i });
  PROLOGUE.forEach((_, i) => s.push({ id: 'prologue', i }));
  s.push({ id: 'inspect', timer: TIMERS.inspect });
  for (const r of ROUNDS) {
    s.push({ id: 'r-intro', r: r.n });
    s.push({ id: 'r-cards', r: r.n });
    s.push({ id: 'r-discuss', r: r.n, timer: TIMERS.discuss });
  }
  s.push({ id: 'm-intro' });
  s.push({ id: 'm-cards' });
  s.push({ id: 'm-discuss', timer: TIMERS.midnightDiscuss });
  s.push({ id: 'vote', timer: TIMERS.vote });
  s.push({ id: 'votes' });
  s.push({ id: 'verdict' });
  EPILOGUE.forEach((_, i) => s.push({ id: 'epi', i }));
  s.push({ id: 'scores' });
  return s;
}

export function stepIndex(steps, pred) {
  return steps.findIndex(pred);
}

// ---------- Состояние ----------
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newCode() {
  let c = '';
  for (let i = 0; i < 5; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return c;
}

export function newState(count = 4, code = newCode()) {
  return {
    v: 1,
    code,
    count,
    players: [],      // {key, name, role, joinedAt}
    step: 0,
    speaker: 0,       // индекс говорящего в шаге r-cards
    told: {},         // key -> true в текущем r-cards
    decisions: {},    // D1..D5 -> true/false
    decisionAt: {},   // D -> номер шага
    votes: {},        // key -> {suspect, method, motive}
    timer: null,      // {total, endsAt|null, left}
    reveals: [],      // публичные открытия: [{d, at}]
    created: Date.now(),
  };
}

export function steps(state) {
  return buildSteps(state.count);
}

export function cur(state) {
  return steps(state)[state.step];
}

export function idxOf(state, id, extra = {}) {
  return steps(state).findIndex(s => s.id === id && Object.entries(extra).every(([k, v]) => s[k] === v));
}

export function rolesInGame(state) {
  return ROLES_BY_COUNT[state.count];
}

export function playerByRole(state, role) {
  return state.players.find(p => p.role === role);
}

// ---------- Игроки ----------
export function addPlayer(state, key, name) {
  const ex = state.players.find(p => p.key === key);
  if (ex) {
    if (name) ex.name = name;
    return { ok: true, player: ex, rejoined: true };
  }
  if (state.players.length >= state.count) return { ok: false, reason: 'full' };
  if (state.step > 0) return { ok: false, reason: 'started' };
  const p = { key, name: (name || '').trim().slice(0, 20) || 'Гость', role: null, joinedAt: Date.now() };
  state.players.push(p);
  return { ok: true, player: p };
}

export function removePlayer(state, key) {
  if (state.step > 0) return false;
  state.players = state.players.filter(p => p.key !== key);
  return true;
}

export function reclaimSeat(state, oldKey, newKey) {
  const p = state.players.find(pp => pp.key === oldKey);
  if (!p) return null;
  for (const m of ['votes', 'told']) {
    if (state[m][oldKey] !== undefined) { state[m][newKey] = state[m][oldKey]; delete state[m][oldKey]; }
  }
  p.key = newKey;
  return p;
}

function shuffle(a, rnd = Math.random) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function dealRoles(state, rnd = Math.random) {
  const roles = shuffle(ROLES_BY_COUNT[state.count], rnd);
  state.players.forEach((p, i) => { p.role = roles[i]; });
}

// ---------- Переходы ----------
export function canAdvance(state) {
  const s = cur(state);
  if (s.id === 'lobby') return state.players.length === state.count;
  return state.step < steps(state).length - 1;
}

export function go(state, delta) {
  const all = steps(state);
  const next = Math.max(0, Math.min(all.length - 1, state.step + delta));
  if (next === state.step) return false;
  if (state.step === 0 && delta > 0) {
    if (state.players.length !== state.count) return false;
    dealRoles(state);
  }
  if (next === 0) return false; // назад в лобби нельзя — роли уже розданы
  state.step = next;
  state.speaker = 0;
  state.told = {};
  const s = all[next];
  state.timer = s.timer ? { total: s.timer, endsAt: Date.now() + s.timer * 1000, left: s.timer * 1000 } : null;
  return true;
}

export function speakingOrder(state) {
  // по кругу, начиная с разных игроков в каждом раунде
  const s = cur(state);
  const n = state.players.length;
  const shift = s.r ? (s.r - 1) % n : 0;
  return state.players.map((_, i) => state.players[(i + shift) % n]);
}

// ---------- Зоны ----------
export function zonesOpen(state) {
  const i = state.step;
  const pro = idxOf(state, 'inspect');
  const r3 = idxOf(state, 'r-intro', { r: 3 });
  const r5 = idxOf(state, 'r-intro', { r: 5 });
  const mDisc = idxOf(state, 'm-discuss');
  const open = [];
  for (const z of ZONES) {
    let ok = false;
    if (z.unlock === 'prologue') ok = i >= pro;
    if (z.unlock === 'round3') ok = i >= r3;
    if (z.unlock === 'round5') ok = i >= r5 || state.decisions.D1 === true;
    if (z.unlock === 'midnight') ok = i >= mDisc || state.decisions.D5 !== undefined;
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
  if (!rolesInGame(state).includes(D.role)) return false;
  if (state.decisions[d] === true) return false;
  if (state.decisions[d] === false && !D.retry) return false;
  const start = D.from === 'midnight' ? idxOf(state, 'm-cards') : idxOf(state, 'r-cards', { r: D.from });
  const end = idxOf(state, 'vote');
  return state.step >= start && state.step <= end;
}

export function decide(state, key, d, yes) {
  const p = state.players.find(pp => pp.key === key);
  const D = DECISIONS[d];
  if (!p || !D || p.role !== D.role) return { ok: false };
  if (!decisionOpen(state, d)) return { ok: false };
  state.decisions[d] = !!yes;
  state.decisionAt[d] = state.step;
  const out = { ok: true };
  if (yes && D.reveal) {
    state.reveals.push({ d, at: Date.now() });
    out.reveal = d;
  }
  return out;
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
  if (!p) return false;
  const vi = idxOf(state, 'vote');
  if (state.step !== vi) return false;
  if (!vote || !vote.suspect || vote.suspect === key) return false;
  if (!state.players.some(pp => pp.key === vote.suspect)) return false;
  if (!VOTE.methods.some(m => m.id === vote.method)) return false;
  if (!VOTE.motives.some(m => m.id === vote.motive)) return false;
  state.votes[key] = { suspect: vote.suspect, method: vote.method, motive: vote.motive };
  return true;
}

export function results(state) {
  const killer = playerByRole(state, GUILTY);
  const tally = {};
  state.players.forEach(p => { tally[p.key] = 0; });
  Object.values(state.votes).forEach(v => { if (tally[v.suspect] !== undefined) tally[v.suspect]++; });
  const detectives = state.players.filter(p => p !== killer);
  const max = Math.max(...Object.values(tally));
  const leaders = Object.keys(tally).filter(k => tally[k] === max);
  const kv = killer ? tally[killer.key] : 0;
  const solved = !!killer && max > 0 && leaders.length === 1 && leaders[0] === killer.key
    && kv >= Math.ceil(detectives.length / 2);

  const D = state.decisions;
  const scores = state.players.map(p => {
    const lines = [];
    const v = state.votes[p.key];
    const add = (label, pts) => lines.push({ label, pts });
    if (p !== killer) {
      if (v && killer && v.suspect === killer.key) add('Голос за виновного', 3);
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
      else if (tally[p.key] === 0) add('Компас не нашли', 2);
      else add('Компас нашли при обыске', -1);
    }
    const total = lines.reduce((a, l) => a + l.pts, 0);
    return { key: p.key, name: p.name, role: p.role, total, lines, votedKiller: !!(v && killer && v.suspect === killer.key) };
  });
  const top = Math.max(...scores.map(s => s.total));
  let winners = scores.filter(s => s.total === top);
  if (winners.length > 1 && winners.some(w => w.votedKiller)) winners = winners.filter(w => w.votedKiller);
  scores.sort((a, b) => b.total - a.total);
  return { tally, killerKey: killer && killer.key, solved, scores, winners: winners.map(w => w.key) };
}

// ---------- Карточки ----------
export function cardsFor(state, role) {
  // все карточки, уже доступные игроку, по порядку
  const out = [];
  const i = state.step;
  for (const r of ROUNDS) {
    const at = idxOf(state, 'r-cards', { r: r.n });
    if (i >= at) {
      const c = r.cards[role];
      out.push({ id: 'r' + r.n, title: `Раунд ${r.n}. ${r.title}`, time: r.time, pub: c.pub, sec: c.sec, img: c.img || null, note: c.note || null });
    }
  }
  if (i >= idxOf(state, 'm-cards')) {
    const c = MIDNIGHT.cards[role];
    out.push({ id: 'm', title: 'Полночь', time: '00:00', final: c.text, guilty: !!c.guilty });
  }
  return out;
}

// ---------- Вид для телефона ----------
export function viewFor(state, key) {
  const p = state.players.find(pp => pp.key === key);
  const s = cur(state);
  const all = steps(state);
  const v = {
    code: state.code,
    count: state.count,
    step: state.step,
    total: all.length,
    phase: s.id,
    r: s.r || null,
    roundTitle: s.r ? ROUNDS[s.r - 1].title : null,
    players: state.players.map(pp => ({ key: pp.key, name: pp.name })),
    timer: state.timer ? timerLeft(state.timer) : null,
    timerRunning: !!(state.timer && state.timer.endsAt),
    captainKey: state.players[0] ? state.players[0].key : null,
  };
  if (!p) return v;
  v.me = { key: p.key, name: p.name };
  if (!p.role) return v;
  const R = ROLES[p.role];
  v.me.role = p.role;
  v.me.roleName = R.name;
  v.me.roleTitle = R.title;
  v.me.portrait = R.portrait;
  v.me.desc = R.desc;
  v.cards = cardsFor(state, p.role);
  v.zones = zonesOpen(state).map(z => zoneView(state, z));
  v.decisions = Object.entries(DECISIONS)
    .filter(([d, D]) => D.role === p.role && rolesInGame(state).includes(D.role))
    .map(([d, D]) => ({ id: d, q: D.q, yes: D.yes, no: D.no, open: decisionOpen(state, d), made: state.decisions[d] }))
    .filter(x => x.open || x.made !== undefined);
  v.whispers = whispersFor(state, p.role);
  if (s.id === 'r-cards') {
    const order = speakingOrder(state);
    v.speakerKey = order[state.speaker] ? order[state.speaker].key : null;
    v.told = !!state.told[p.key];
  }
  if (s.id === 'vote') {
    v.vote = {
      suspects: state.players.filter(pp => pp.key !== p.key).map(pp => ({ key: pp.key, name: pp.name, roleName: ROLES[pp.role].name })),
      methods: VOTE.methods,
      motives: VOTE.motives,
      mine: state.votes[p.key] || null,
      done: Object.keys(state.votes).length,
    };
  }
  if (state.step >= idxOf(state, 'verdict')) {
    const res = results(state);
    const me = res.scores.find(x => x.key === p.key);
    v.result = {
      solved: res.solved,
      killerName: ROLES[GUILTY].name,
      me,
      place: res.scores.findIndex(x => x.key === p.key) + 1,
      winner: res.winners.includes(p.key),
      showScores: s.id === 'scores',
    };
  }
  return v;
}

export function timerLeft(t) {
  if (!t) return null;
  if (t.endsAt) return Math.max(0, t.endsAt - Date.now());
  return Math.max(0, t.left);
}

export function timerPause(state) {
  const t = state.timer;
  if (!t) return;
  if (t.endsAt) { t.left = Math.max(0, t.endsAt - Date.now()); t.endsAt = null; }
  else { t.endsAt = Date.now() + t.left; }
}

export function timerAdd(state, sec) {
  const t = state.timer;
  if (!t) return;
  if (t.endsAt) t.endsAt = Math.max(Date.now(), t.endsAt) + sec * 1000;
  else t.left = Math.max(0, t.left) + sec * 1000;
}
