// Настройки сайта. Заполните после регистрации в Supabase и рекламных сетях.
// Пока поля пустые, сайт работает в демо-режиме: оценки и комментарии
// сохраняются только в браузере посетителя, вместо рекламы — пустые блоки.
window.ULIKA_CONFIG = {
  // Supabase → Project Settings → API
  supabaseUrl: '',          // например 'https://abcdxyz.supabase.co'
  supabaseAnonKey: '',      // Publishable key (sb_publishable_…) или Legacy → anon public (eyJ…). НЕ secret и НЕ service_role!

  ads: {
    // Какую сеть показывать, если заданы обе: 'yandex' или 'google'
    prefer: 'yandex',
    // Рекламная сеть Яндекса: ID блоков вида 'R-A-1234567-1'
    yandex: { top: '', left: '', bottom: '' },
    // Google AdSense: ca-pub-… и ID слотов
    google: { client: '', top: '', left: '', bottom: '' },
    // Показывать пустые рамки «Место для рекламы», пока ID не заданы
    placeholders: true,
  },
};
