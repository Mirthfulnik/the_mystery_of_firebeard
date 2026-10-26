// Карточка игры: трейлер и скриншоты, тизер, оценки, сюжет, правила, комментарии.
import { GAMES, byId, playersLabel } from './data.js';
import { stats, track, myRating, rate, comments, addComment } from './api.js';
import { frame, esc, num, plural, ICON, stars, share } from './ui.js';
import { setupApp, install, onInstalled, installAllowed, installLabel, installHint } from './install.js';

frame('');

const id = new URLSearchParams(location.search).get('id') || GAMES[0].id;
const g = byId(id);
const page = document.getElementById('page');

if (!g) {
  page.innerHTML = `<div class="empty">Такой игры нет. <a href="index.html">Вернуться в каталог</a></div>`;
} else {
  document.title = `${g.title} — Улика`;
  render();
  track(g.id, 'view').then(refreshStats);
  loadComments();
}

function render() {
  const media = [{ video: true, src: g.trailer, thumb: g.trailerPoster, alt: 'Трейлер' }, ...g.shots];
  page.innerHTML = `
  <nav class="crumbs" aria-label="Навигация"><a href="index.html">Каталог</a> / ${esc(g.themes[0])} / ${esc(g.title)}</nav>
  <h1 class="gtitle">${esc(g.title)}</h1>
  <p class="gtag">${esc(g.tagline)}</p>

  <div class="ghead">
    <div>
      <div class="viewer" id="viewer"></div>
      <div class="thumbs" role="tablist" aria-label="Трейлер и скриншоты">
        ${media.map((m, i) => `<button class="thumb ${m.video ? 'video' : ''}" role="tab" data-i="${i}" aria-current="${i === 0}" aria-label="${esc(m.alt)}" style="background-image:url('${m.thumb}')"></button>`).join('')}
      </div>
    </div>

    <aside class="side">
      <div class="capsule"><img src="${g.cover}" alt="" width="1280" height="720"></div>
      <p class="teaser">${esc(g.teaser)}</p>
      <div class="statrow" id="stats"></div>
      <dl class="facts">
        <dt>Игроки</dt><dd>${playersLabel(g.players)}<br><small style="color:var(--muted);font-weight:400">лучше всего ${g.players.best}</small></dd>
        <dt>Возраст</dt><dd><span class="age">${g.age}+</span></dd>
        <dt>Длительность</dt><dd>${g.duration}</dd>
        <dt>Формат</dt><dd>${esc(g.format)}</dd>
        <dt>Цена</dt><dd>${esc(g.price)}</dd>
        <dt>Темы</dt><dd>${g.themes.map(t => `<a class="chip" style="font-size:.78rem;margin:0 4px 4px 0" href="index.html?theme=${encodeURIComponent(t)}#all">${esc(t)}</a>`).join('')}</dd>
      </dl>
      <div class="actions">
        <a class="btn big" href="${g.playUrl}">${ICON.play}Играть</a>
        <button class="btn ghost big" data-share>${ICON.share}Поделиться</button>
        ${installAllowed(g) ? `<button class="btn ghost big" data-install>${ICON.download}${installLabel()}</button>` : ''}
      </div>
      ${installAllowed(g) ? `<p class="hint-small" data-install-hint>${installHint()}</p>` : ''}
    </aside>
  </div>

  <nav class="tabs" aria-label="Разделы игры">
    <a href="#plot" aria-current="true">Сюжет</a><a href="#rules">Правила и условия</a><a href="#rate">Оценки</a><a href="#comments">Комментарии <span id="ccount"></span></a>
  </nav>

  <div class="body2">
    <div>
      <section class="block prose" id="plot">
        <h2>Сюжет</h2>
        <span class="nospoil">✓ Без спойлеров — только завязка</span>
        ${g.plot.map(p => `<p>${esc(p)}</p>`).join('')}
      </section>

      <section class="block" id="rules">
        <h2>Правила и условия</h2>
        <div class="rules">${g.rules.map(r => `<div class="rule"><h3>${esc(r.h)}</h3><p>${esc(r.t)}</p></div>`).join('')}</div>
      </section>

      <section class="block" id="comments">
        <h2>Комментарии</h2>
        <form class="cform" id="cform">
          <label class="sr" for="cname">Имя</label>
          <input id="cname" name="name" maxlength="40" placeholder="Ваше имя" required autocomplete="nickname">
          <label class="sr" for="cbody">Комментарий</label>
          <textarea id="cbody" name="body" maxlength="1000" placeholder="Как прошла игра? Только без спойлеров о том, кто виновен 🙂" required></textarea>
          <div class="row"><button class="btn" type="submit">Отправить</button><span class="err" id="cerr" role="alert"></span></div>
        </form>
        <ul class="clist" id="clist"><li style="color:var(--muted)">Загружаем…</li></ul>
      </section>
    </div>

    <aside>
      <section class="block" id="rate">
        <h2>Оценки</h2>
        <div class="ratebox">
          <div class="big" id="ravg"></div>
          <div id="rmine-label" style="font-weight:600;margin-bottom:4px">Ваша оценка</div>
          <div class="stars" role="radiogroup" aria-labelledby="rmine-label" id="rstars">
            ${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-n="${n}" aria-label="${n} из 5">${ICON.star}</button>`).join('')}
          </div>
          <div class="ratemsg" id="rmsg" aria-live="polite"></div>
        </div>
      </section>
    </aside>
  </div>`;

  // Галерея
  const viewer = document.getElementById('viewer');
  const show = i => {
    const m = media[i];
    viewer.innerHTML = m.video
      ? `<video src="${m.src}" poster="${m.thumb}" controls playsinline preload="metadata" aria-label="Трейлер игры"></video>`
      : `<div class="vbg" style="background-image:url('${m.thumb}')"></div><img class="main" src="${m.src}" alt="${esc(m.alt)}"><div class="cap">${esc(m.alt)}</div>`;
    page.querySelectorAll('.thumb').forEach(t => t.setAttribute('aria-current', String(+t.dataset.i === i)));
  };
  show(0);
  page.querySelector('.thumbs').addEventListener('click', e => { const t = e.target.closest('.thumb'); if (t) show(+t.dataset.i); });
  // Предзагрузка скриншотов, чтобы листались мгновенно
  setTimeout(() => g.shots.forEach(s => { const im = new Image(); im.src = s.src; }), 1500);

  page.querySelector('[data-share]').addEventListener('click', () => share(g, refreshStats));
  setupApp(g);
  onInstalled(refreshStats);
  const ib = page.querySelector('[data-install]');
  if (ib) ib.addEventListener('click', () => install(g));

  // Вкладки: подсветка текущего раздела
  const tabs = [...page.querySelectorAll('.tabs a')];
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) tabs.forEach(a => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-40% 0px -55% 0px' });
  ['plot', 'rules', 'rate', 'comments'].forEach(s => io.observe(document.getElementById(s)));

  // Оценка
  const paint = n => page.querySelectorAll('#rstars button').forEach(b => { b.classList.toggle('on', +b.dataset.n <= n); b.setAttribute('aria-checked', String(+b.dataset.n === n)); });
  let mine = myRating(g.id);
  paint(mine);
  document.getElementById('rmsg').textContent = mine ? 'Можно изменить оценку в любой момент' : 'Сыграли? Оцените игру';
  const rs = document.getElementById('rstars');
  rs.addEventListener('mouseover', e => { const b = e.target.closest('button'); if (b) paint(+b.dataset.n); });
  rs.addEventListener('mouseleave', () => paint(mine));
  rs.addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const cur = +(document.activeElement.dataset.n || mine || 1);
    const n = Math.min(5, Math.max(1, cur + d));
    rs.querySelector(`[data-n="${n}"]`).focus(); paint(n);
  });
  rs.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    mine = +b.dataset.n; paint(mine);
    const msg = document.getElementById('rmsg');
    try { await rate(g.id, mine); msg.textContent = `Спасибо! Ваша оценка: ${mine} из 5`; refreshStats(); }
    catch (er) { msg.textContent = 'Не удалось сохранить оценку, попробуйте ещё раз'; }
  });

  // Комментарий
  try { document.getElementById('cname').value = localStorage.getItem('ulika.name') || ''; } catch (e) { /* ignore */ }
  document.getElementById('cform').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, err = document.getElementById('cerr');
    const name = f.name.value.trim(), body = f.body.value.trim();
    if (!name) { err.textContent = 'Укажите имя'; return; }
    if (body.length < 2) { err.textContent = 'Напишите хотя бы пару слов'; return; }
    const btn = f.querySelector('button'); btn.disabled = true; err.textContent = '';
    try {
      await addComment(g.id, name, body);
      try { localStorage.setItem('ulika.name', name); } catch (e2) { /* ignore */ }
      f.body.value = '';
      await loadComments(); refreshStats();
    } catch (er) { err.textContent = er.message; }
    btn.disabled = false;
  });
}

async function refreshStats() {
  const s = (await stats([g.id]))[g.id];
  const r = s.rating ? s.rating.toFixed(1).replace('.', ',') : '—';
  document.getElementById('stats').innerHTML = `
    <div class="stat"><b>${r}</b><span>${s.votes} ${plural(s.votes, 'оценка', 'оценки', 'оценок')}</span></div>
    <div class="stat"><b>${num(s.views)}</b><span>${plural(s.views, 'просмотр', 'просмотра', 'просмотров')}</span></div>
    <div class="stat"><b>${num(s.shares)}</b><span>${plural(s.shares, 'поделился', 'поделились', 'поделились')}</span></div>
    ${g.app ? `<div class="stat"><b>${num(s.installs)}</b><span>${plural(s.installs, 'установка', 'установки', 'установок')} на ПК</span></div>` : ''}`;
  document.getElementById('ravg').innerHTML = `<b>${r}</b><div>${stars(s.rating, 'lg')}<small>${s.votes ? `${s.votes} ${plural(s.votes, 'оценка', 'оценки', 'оценок')}` : 'Пока никто не оценил'}</small></div>`;
  document.getElementById('ccount').textContent = s.comments ? `(${s.comments})` : '';
}

async function loadComments() {
  const list = await comments(g.id);
  const ul = document.getElementById('clist');
  const fmt = d => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  ul.innerHTML = list.length
    ? list.map(c => `<li><div class="who"><b>${esc(c.name)}</b><time datetime="${esc(c.created_at)}">${fmt(c.created_at)}</time></div><p>${esc(c.body)}</p></li>`).join('')
    : '<li style="color:var(--muted)">Комментариев пока нет — будьте первым.</li>';
}
