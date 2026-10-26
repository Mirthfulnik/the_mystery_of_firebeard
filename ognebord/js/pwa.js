// Установка игры как приложения (PWA) и офлайн-кэш.
export const pwa = { prompt: null, installed: false, onChange: null };

pwa.standalone = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e)));
}

addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  pwa.prompt = e;
  pwa.onChange && pwa.onChange();
});
addEventListener('appinstalled', () => {
  pwa.prompt = null; pwa.installed = true;
  pwa.onChange && pwa.onChange();
});

pwa.install = async () => {
  if (!pwa.prompt) return false;
  pwa.prompt.prompt();
  const { outcome } = await pwa.prompt.userChoice;
  pwa.prompt = null;
  pwa.onChange && pwa.onChange();
  return outcome === 'accepted';
};
