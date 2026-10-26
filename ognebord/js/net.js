// Связь ТВ ↔ телефоны через публичный MQTT-брокер (WebSocket по https).
// Работает из любых сетей: Wi‑Fi, мобильный интернет, разные квартиры.
// Сообщения шифруются AES-GCM ключом, который передаётся только в QR-коде (после #).
/* global mqtt */

export const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

// ?broker=ws://127.0.0.1:8888 — свой брокер (для проверки)
export function brokerOverride() {
  return new URLSearchParams(location.search).get('broker');
}
export function brokerURL(i) {
  return brokerOverride() || BROKERS[i % BROKERS.length];
}
export function queryKeep() {
  const b = brokerOverride();
  return b ? `?broker=${encodeURIComponent(b)}` : '';
}

export function randomToken(n = 12) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const enc = new TextEncoder();
const dec = new TextDecoder();
async function sha(str) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64(buf) {
  let s = '';
  const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

export class Channel {
  // opts: {room, secret, broker (index), mine: 'host' | clientKey, onMsg, onStatus}
  constructor(opts) {
    this.o = opts;
    this.ready = this.init();
    this.topicCache = new Map();
  }

  async init() {
    const { room, secret } = this.o;
    const raw = await crypto.subtle.digest('SHA-256', enc.encode('ognebord|' + secret));
    this.key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    this.base = 'ognebord26/' + (await sha(room + ':' + secret)).slice(0, 32);
    this.myTopic = this.o.mine === 'host' ? this.base + '/h' : await this.clientTopic(this.o.mine);
    this.connect();
  }

  async clientTopic(key) {
    if (!this.topicCache.has(key)) this.topicCache.set(key, this.base + '/c/' + (await sha(key + '|' + this.o.secret)).slice(0, 20));
    return this.topicCache.get(key);
  }

  connect() {
    const url = brokerURL(this.o.broker || 0);
    this.status('connecting');
    const c = mqtt.connect(url, {
      clientId: 'og_' + randomToken(8),
      keepalive: 25,
      reconnectPeriod: 2500,
      connectTimeout: 9000,
      clean: true,
    });
    this.client = c;
    c.on('connect', () => {
      c.subscribe(this.myTopic, { qos: 1 }, err => {
        if (err) { this.status('error'); return; }
        this.status('online');
        if (this.o.onConnect) this.o.onConnect();
      });
    });
    c.on('reconnect', () => this.status('reconnecting'));
    c.on('offline', () => this.status('reconnecting'));
    c.on('error', () => this.status('reconnecting'));
    c.on('message', async (_t, payload) => {
      try {
        const data = unb64(dec.decode(payload));
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, this.key, data.slice(12));
        this.o.onMsg(JSON.parse(dec.decode(pt)));
      } catch (e) { /* чужое или битое сообщение — пропускаем */ }
    });
  }

  status(s) {
    this.state = s;
    if (this.o.onStatus) this.o.onStatus(s);
  }

  get online() { return this.state === 'online'; }

  async publish(topic, msg) {
    await this.ready;
    if (!this.client || !this.client.connected) return false;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, enc.encode(JSON.stringify(msg)));
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), 12);
    this.client.publish(topic, b64(out), { qos: 1 });
    return true;
  }

  async toHost(msg) { await this.ready; return this.publish(this.base + '/h', msg); }
  async toClient(key, msg) { await this.ready; return this.publish(await this.clientTopic(key), msg); }

  close() { try { this.client.end(true); } catch (e) { /* ignore */ } }
}

// Проверка, какой брокер доступен: возвращает индекс первого рабочего.
export function probeBroker(startIdx = 0, timeout = 7000) {
  if (brokerOverride()) return Promise.resolve(0);
  return new Promise(resolve => {
    let i = startIdx;
    const tryOne = () => {
      if (i >= startIdx + BROKERS.length) { resolve(startIdx); return; }
      const idx = i % BROKERS.length;
      const c = mqtt.connect(BROKERS[idx], { clientId: 'og_probe_' + randomToken(6), connectTimeout: timeout, reconnectPeriod: 0 });
      const t = setTimeout(() => { c.end(true); i++; tryOne(); }, timeout + 500);
      c.on('connect', () => { clearTimeout(t); c.end(true); resolve(idx); });
      c.on('error', () => { clearTimeout(t); c.end(true); i++; tryOne(); });
    };
    tryOne();
  });
}
