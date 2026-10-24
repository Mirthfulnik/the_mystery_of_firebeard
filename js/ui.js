// Общие элементы телефонов игрока и ведущего.
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const IMG = id => {
  if (!id) return '';
  if (id.startsWith('CH-')) return `img/ch/${id}.webp`;
  if (id.startsWith('SC-')) return `img/sc/${id}.webp`;
  return `img/ev/${id}.webp`;
};
export const FACE = portrait => `img/face/${portrait}.webp`;

export const fmt = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export const store = {
  get(k, d) { try { const v = localStorage.getItem('ognebord.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ognebord.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

export function hashParams() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { room: (h.get('r') || '').toUpperCase(), secret: h.get('s') || '', broker: Number(h.get('b') || 0), gm: h.get('g') || '' };
}

export function evImgHTML(img, note) {
  if (!img) return '';
  return `<div class="evimg note-wrap"><img src="${IMG(img)}" alt="">${note ? `<div class="note-text">${esc(note)}</div>` : ''}</div>`;
}

// Карточка раунда или финальная карточка. opened — сломана ли печать (id карточки → true).
export function envHTML(c, opened, prefix = '') {
  if (c.final !== undefined) {
    return `<article class="env"><div class="hd"><b>${esc(c.title)}</b><span>${esc(c.time)}</span></div>
      <div class="parch final ${c.guilty ? 'guilty' : ''}"><div class="verdict">${c.guilty ? 'Вы виновны.' : 'Финальная карточка'}</div><p>${esc(c.final)}</p></div></article>`;
  }
  const id = prefix + c.id;
  const isOpen = !!opened[id];
  return `<article class="env"><div class="hd"><b>${esc(c.title)}</b><span>${esc(c.time)}</span></div>
    <div class="parch">
      <div class="pub"><h4>Расскажите всем</h4><p>${esc(c.pub)}</p></div>
      <div class="sec ${isOpen ? '' : 'sealed'}">
        <div class="inner"><h4>Только для вас</h4><p>${esc(c.sec)}</p>${evImgHTML(c.img, c.note)}</div>
        ${isOpen ? `<button class="hidebtn" data-close="${id}">Запечатать снова</button>` : `<button class="seal" data-open="${id}">Сломать печать</button>`}
      </div>
    </div></article>`;
}

export function decisionHTML(d) {
  if (d.made === true) return `<div class="decision done"><p class="q">${esc(d.q)}</p><p class="state">Решено: да</p></div>`;
  if (!d.open) return `<div class="decision done"><p class="q">${esc(d.q)}</p><p class="state">Решено: нет</p></div>`;
  const pending = d.made === false ? '<p class="small" style="margin:0 0 8px">Пока ответ «нет». Можно передумать до голосования.</p>' : '';
  return `<div class="decision"><p class="q">${esc(d.q)}</p>${pending}
    <dl><dt>Да</dt><dd>${esc(d.yes)}</dd><dt>Нет</dt><dd>${esc(d.no)}</dd></dl>
    <div class="opts"><button class="btn green" data-decide="${d.id}" data-yes="1">Да</button>
    <button class="btn ghost" data-decide="${d.id}" data-yes="0" ${d.made === false ? 'disabled' : ''}>Нет</button></div></div>`;
}

export function confirmHTML(d, yes) {
  return `<h3>${yes ? 'Точно «да»?' : 'Ответить «нет»?'}</h3><p>${esc(d ? (yes ? d.yes : d.no) : '')}</p>
    <p class="small">${yes ? 'Это решение нельзя отменить.' : ''}</p>
    <div class="row"><button class="btn ghost" data-act="closesheet">Отмена</button>
    <button class="btn ${yes ? 'green' : ''}" data-act="confirm">${yes ? 'Да, решено' : 'Нет'}</button></div>`;
}

export function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }

let toastT;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, 3500);
}
