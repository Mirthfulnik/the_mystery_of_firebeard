// Оценка и отзыв в конце игры. Уходят в ту же базу, что и на сайте «Улики»,
// поэтому сразу появляются на странице игры в каталоге.
import { rate, addComment, myRating } from '../../js/api.js';

const GAME = 'ognebord';
const SITE_PAGE = '../game.html?id=' + GAME;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const d = { stars: myRating(GAME) || 0, name: null, text: '', busy: false, sent: false, err: '' };
let rerender = () => {};

export function feedbackHTML(defaultName = '') {
  if (d.name === null) d.name = defaultName || '';
  if (d.sent) {
    return `<div class="fb parch"><h2>Спасибо за отзыв!</h2>
      <p>Ваша оценка${d.text.trim() ? ' и комментарий' : ''} уже на сайте «Улики».</p>
      <a class="btn wide" href="${SITE_PAGE}#comments" target="_blank" rel="noopener">Посмотреть на сайте</a></div>`;
  }
  const star = n => `<button type="button" class="fbstar ${n <= d.stars ? 'on' : ''}" data-star="${n}" aria-label="${n} из 5" aria-pressed="${n === d.stars}">★</button>`;
  return `<form class="fb parch" id="fbform">
    <h2>Как вам игра?</h2>
    <p>Поставьте оценку и напишите пару слов — отзыв появится на сайте и поможет другим компаниям выбрать игру.</p>
    <div class="fbstars" role="group" aria-label="Оценка">${[1, 2, 3, 4, 5].map(star).join('')}</div>
    <label class="fbl" for="fbname">Имя</label>
    <input id="fbname" maxlength="40" value="${esc(d.name)}" autocomplete="nickname">
    <label class="fbl" for="fbtext">Комментарий</label>
    <textarea id="fbtext" maxlength="1000" placeholder="Что понравилось? Только без спойлеров о том, кто виновен">${esc(d.text)}</textarea>
    ${d.err ? `<p class="fberr" role="alert">${esc(d.err)}</p>` : ''}
    <button class="btn wide" type="submit" ${d.busy ? 'disabled' : ''}>${d.busy ? 'Отправляем…' : 'Отправить отзыв'}</button>
  </form>`;
}

// Пока человек печатает, экран не перерисовывается — иначе пропадёт фокус.
export const feedbackFocused = () => !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('#fbform'));

export function bindFeedback(onChange) {
  // перед перерисовкой снимаем фокус, иначе экран решит, что человек ещё печатает
  rerender = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); onChange(); };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-star]');
    if (!b || !b.closest('#fbform')) return;
    d.stars = +b.dataset.star; d.err = '';
    const er = document.querySelector('#fbform .fberr'); if (er) er.remove();
    document.querySelectorAll('#fbform [data-star]').forEach(x => { const on = +x.dataset.star <= d.stars; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(+x.dataset.star === d.stars)); });
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'fbname') d.name = e.target.value;
    if (e.target.id === 'fbtext') d.text = e.target.value;
  });
  document.addEventListener('submit', async e => {
    if (e.target.id !== 'fbform') return;
    e.preventDefault();
    if (!d.stars) { d.err = 'Выберите оценку от 1 до 5 звёзд'; rerender(); return; }
    const text = d.text.trim(), name = d.name.trim() || 'Гость';
    if (text && text.length < 2) { d.err = 'Напишите хотя бы пару слов'; rerender(); return; }
    d.busy = true; d.err = ''; rerender();
    try {
      await rate(GAME, d.stars);
      if (text) await addComment(GAME, name, text);
      d.sent = true;
      try { window.ym && window.ym(113916917, 'reachGoal', 'game_review', { stars: d.stars }); } catch (er) { /* ignore */ }
    } catch (er) {
      d.err = (er && er.message) || 'Не удалось отправить. Проверьте интернет и попробуйте ещё раз.';
    }
    d.busy = false;
    rerender();
  });
}
