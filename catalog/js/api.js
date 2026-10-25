// Оценки, просмотры, репосты и комментарии.
// С настроенным Supabase — общие для всех посетителей, без него — только в этом браузере.
const C = window.ULIKA_CONFIG || {};
export const live = !!(C.supabaseUrl && C.supabaseAnonKey);

const ls = {
  get(k, d) { try { const v = localStorage.getItem('ulika.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ulika.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

export const visitor = (() => {
  let v = ls.get('visitor', null);
  if (!v) {
    const a = new Uint8Array(12); crypto.getRandomValues(a);
    v = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
    ls.set('visitor', v);
  }
  return v;
})();

async function rest(path, opts = {}) {
  const r = await fetch(`${C.supabaseUrl.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...opts,
    // Старый ключ anon (eyJ…) передаём и как Bearer; новый publishable (sb_publishable_…) — только в apikey.
    headers: { apikey: C.supabaseAnonKey, ...(C.supabaseAnonKey.startsWith('eyJ') ? { Authorization: `Bearer ${C.supabaseAnonKey}` } : {}), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) { const t = await r.text(); throw new Error(t || r.statusText); }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}
const rpc = (fn, args) => rest('rpc/' + fn, { method: 'POST', body: JSON.stringify(args) });

const EMPTY = { views: 0, shares: 0, rating: null, votes: 0, comments: 0 };

// ---------- демо-режим ----------
const demo = {
  stats(id) {
    const d = ls.get('demo.' + id, { views: [], shares: 0, ratings: {}, comments: [] });
    const r = Object.values(d.ratings);
    return { views: d.views.length, shares: d.shares, rating: r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length * 10) / 10 : null, votes: r.length, comments: d.comments.length };
  },
  mut(id, f) { const d = ls.get('demo.' + id, { views: [], shares: 0, ratings: {}, comments: [] }); f(d); ls.set('demo.' + id, d); },
};

export async function stats(ids) {
  const out = {};
  ids.forEach(id => { out[id] = { ...EMPTY }; });
  if (!live) { ids.forEach(id => { out[id] = demo.stats(id); }); return out; }
  try {
    const rows = await rpc('game_stats', { p_ids: ids });
    rows.forEach(r => { out[r.game_id] = { views: +r.views, shares: +r.shares, rating: r.rating === null ? null : +r.rating, votes: +r.votes, comments: +r.comments }; });
  } catch (e) { console.warn('stats', e); }
  return out;
}

export async function track(id, kind) {
  const key = `tracked.${id}.${kind}`;
  if (kind === 'view' && Date.now() - ls.get(key, 0) < 3600e3) return;
  ls.set(key, Date.now());
  if (!live) { demo.mut(id, d => { if (kind === 'view') { if (!d.views.includes(visitor)) d.views.push(visitor); } else d.shares++; }); return; }
  try { await rpc('track', { p_game: id, p_kind: kind, p_visitor: visitor }); } catch (e) { console.warn('track', e); }
}

export const myRating = id => ls.get('rated.' + id, 0);

export async function rate(id, stars) {
  ls.set('rated.' + id, stars);
  if (!live) { demo.mut(id, d => { d.ratings[visitor] = stars; }); return; }
  await rpc('rate', { p_game: id, p_visitor: visitor, p_stars: stars });
}

export async function comments(id) {
  if (!live) return ls.get('demo.' + id, { comments: [] }).comments.slice().reverse();
  try {
    return await rest(`comments?game_id=eq.${encodeURIComponent(id)}&select=id,name,body,created_at&order=created_at.desc&limit=100`);
  } catch (e) { console.warn('comments', e); return []; }
}

export async function addComment(id, name, body) {
  if (!live) { demo.mut(id, d => { d.comments.push({ id: Date.now(), name, body, created_at: new Date().toISOString() }); }); return; }
  try { await rpc('add_comment', { p_game: id, p_visitor: visitor, p_name: name, p_body: body }); }
  catch (e) { throw new Error(String(e.message).includes('too_many') ? 'Слишком много комментариев подряд. Подождите несколько минут.' : 'Не удалось отправить. Проверьте интернет и попробуйте ещё раз.'); }
}
