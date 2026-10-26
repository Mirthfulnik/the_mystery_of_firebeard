// Установка игры как приложения (PWA) прямо из каталога.
// У игры в data.js задано app: { manifest, sw, scope } — её собственный manifest и service worker.
import { esc } from './ui.js';

let deferred = null, current = null;
const listeners = new Set();
const notify = () => listeners.forEach(f => f());

addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; notify(); });
addEventListener('appinstalled', () => { deferred = null; notify(); });

// Подключить manifest игры к странице каталога, чтобы браузер предложил установить именно её.
export function setupApp(game) {
  if (!game || !game.app || current === game.id) return;
  current = game.id;
  let link = document.querySelector('link[rel="manifest"]');
  if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link); }
  link.href = game.app.manifest;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(game.app.sw, { scope: game.app.scope }).catch(err => console.warn('sw', err));
}

export const onInstallChange = f => listeners.add(f);
export const canPrompt = () => !!deferred;

export async function install(game) {
  if (deferred) {
    const e = deferred; deferred = null;
    e.prompt();
    const { outcome } = await e.userChoice;
    notify();
    if (outcome === 'accepted') toast(`«${game.title}» устанавливается — ярлык появится на рабочем столе и в меню «Пуск».`);
    return;
  }
  help(game);
}

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

function help(game) {
  const ua = navigator.userAgent;
  const edge = /Edg\//.test(ua), chrome = /Chrome\//.test(ua) && !edge && !/OPR\//.test(ua) && !/YaBrowser/.test(ua);
  const yandex = /YaBrowser/.test(ua);
  let how;
  if (chrome) how = 'Нажмите значок «Установить» справа в адресной строке (монитор со стрелкой) или меню ⋮ → «Трансляция, сохранение и отправка» → «Установить страницу как приложение».';
  else if (edge) how = 'Нажмите значок «Приложение доступно» справа в адресной строке или меню ⋯ → «Приложения» → «Установить этот сайт как приложение».';
  else if (yandex) how = 'Нажмите значок установки справа в адресной строке или меню ☰ → «Дополнения» → «Установить приложение».';
  else how = 'Ваш браузер не умеет устанавливать сайты как приложения. Откройте эту страницу в Google Chrome или Microsoft Edge — или просто играйте в браузере, это ничем не хуже.';
  const el = document.createElement('div');
  el.className = 'sheet-back';
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Установить игру">
    <h3>Установить «${esc(game.title)}»</h3>
    <p style="margin:0;color:var(--muted)">Если игра уже установлена, откройте её ярлыком на рабочем столе или в меню «Пуск».</p>
    <p style="margin:0">${how}</p>
    <button class="btn ghost" data-close>Понятно</button></div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) el.remove(); });
  el.addEventListener('keydown', e => { if (e.key === 'Escape') el.remove(); });
  el.querySelector('[data-close]').focus();
}
