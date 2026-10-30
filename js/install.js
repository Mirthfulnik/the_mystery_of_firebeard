// Установка игры как приложения (PWA) прямо из каталога.
// У игры в data.js задано app: { manifest, sw, scope } — её собственный manifest и service worker.
import { esc, goal } from './ui.js';
import { track } from './api.js';

let deferred = null, current = null;

// Кнопку установки показываем только на ноутбуках, компьютерах и планшетах:
// на телефоне игра — это пульт игрока, а на телевизоре ставить приложение из браузера нельзя.
const TV_UA = /SmartTV|SMART-TV|Tizen|Web0S|webOS|HbbTV|BRAVIA|NetCast|AFT[A-Z]|Android TV|GoogleTV|CrKey|Roku|VIDAA|Hisense/i;
export function deviceKind() {
  const ua = navigator.userAgent;
  if (TV_UA.test(ua)) return 'tv';
  const touch = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  const short = Math.min(screen.width, screen.height);
  if (touch && short < 600) return 'phone';
  if (/iPhone|iPod|Android.+Mobile|Windows Phone/i.test(ua)) return 'phone';
  if (touch || /iPad|Android/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'tablet';
  return 'desktop';
}
export const installAllowed = g => !!(g && g.app) && ['desktop', 'tablet'].includes(deviceKind());
export const installLabel = () => deviceKind() === 'tablet' ? 'Установить приложение' : 'Установить на ПК';
const listeners = new Set();
const notify = () => listeners.forEach(f => f());

addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; notify(); });
let installing = null;
addEventListener('appinstalled', () => { deferred = null; if (installing) countInstall(installing); notify(); });
const countDone = new Set();
async function countInstall(game) {
  if (countDone.has(game.id)) return;
  countDone.add(game.id);
  await track(game.id, 'install');
  onCounted && onCounted();
}
let onCounted = null;
export const onInstalled = f => { onCounted = f; };

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
    installing = game;
    e.prompt();
    const { outcome } = await e.userChoice;
    notify();
    if (outcome === 'accepted') { countInstall(game); goal('install'); }
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
  const ios = /iPad|iPhone/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) how = 'В Safari нажмите «Поделиться» (квадрат со стрелкой вверх) → «На экран „Домой“». На главном экране появится значок игры.';
  else if (chrome) how = 'Нажмите значок «Установить» справа в адресной строке (монитор со стрелкой) или меню ⋮ → «Трансляция, сохранение и отправка» → «Установить страницу как приложение».';
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
export const installHint = () => deviceKind() === 'tablet' ? 'Значок на главном экране, игра в своём окне и быстрее запускается' : 'Ярлык на рабочем столе, игра в своём окне и быстрее запускается';
