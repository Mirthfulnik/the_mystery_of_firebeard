// Связь ТВ ↔ телефоны через WebRTC (PeerJS). Отдельный сервер не нужен:
// экран ведущего сам хранит игру, телефоны подключаются к нему напрямую.
/* global Peer */

export const PREFIX = 'ognebord-hw26-';

// ?peer=host:port — свой сервер PeerJS (для проверки без интернета).
export function peerConfig() {
  const q = new URLSearchParams(location.search);
  const cfg = { debug: 1 };
  const p = q.get('peer');
  if (p) {
    const [host, port] = p.split(':');
    Object.assign(cfg, { host, port: Number(port || 9000), path: '/', secure: q.get('peersecure') === '1' });
  }
  return cfg;
}

export function peerParam() {
  const q = new URLSearchParams(location.search);
  const p = q.get('peer');
  return p ? `&peer=${encodeURIComponent(p)}` + (q.get('peersecure') ? '&peersecure=1' : '') : '';
}

// ---------- Ведущий ----------
export class HostNet {
  constructor(code, handlers) {
    this.code = code;
    this.h = handlers;   // {onStatus, onJoin(conn,msg), onMsg(conn,msg), onClose(conn)}
    this.conns = new Set();
    this.tries = 0;
    this.start();
  }
  start() {
    this.h.onStatus('connecting');
    const peer = new Peer(PREFIX + this.code, peerConfig());
    this.peer = peer;
    peer.on('open', () => { this.tries = 0; this.h.onStatus('online'); });
    peer.on('connection', conn => this.attach(conn));
    peer.on('disconnected', () => {
      this.h.onStatus('reconnecting');
      setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1500);
    });
    peer.on('error', err => {
      const t = err.type;
      if (t === 'unavailable-id') {
        // старая вкладка ещё держит код — ждём, пока сервер его отпустит
        this.h.onStatus('busy');
        peer.destroy();
        if (this.tries++ < 40) setTimeout(() => this.start(), 3000);
        else this.h.onStatus('error', 'Код комнаты занят. Начните новую игру.');
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(t)) {
        this.h.onStatus('reconnecting');
        peer.destroy();
        setTimeout(() => this.start(), 3000);
      } else if (t !== 'peer-unavailable') {
        console.warn('peer error', t, err);
      }
    });
  }
  attach(conn) {
    conn.on('open', () => { this.conns.add(conn); });
    conn.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;
      conn.lastSeen = Date.now();
      if (msg.t === 'ping') { this.send(conn, { t: 'pong' }); return; }
      if (msg.t === 'join') this.h.onJoin(conn, msg);
      else this.h.onMsg(conn, msg);
    });
    conn.on('close', () => { this.conns.delete(conn); this.h.onClose(conn); });
    conn.on('error', () => { this.conns.delete(conn); this.h.onClose(conn); });
  }
  send(conn, msg) {
    try { if (conn && conn.open) conn.send(msg); } catch (e) { console.warn(e); }
  }
  destroy() { if (this.peer) this.peer.destroy(); }
}

// ---------- Телефон ----------
export class PlayerNet {
  constructor(code, handlers) {
    this.code = code;
    this.h = handlers;   // {onStatus, onMsg, getJoin()}
    this.start();
    setInterval(() => this.ping(), 4000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !(this.conn && this.conn.open)) this.reconnect();
    });
  }
  start() {
    this.h.onStatus('connecting');
    const peer = new Peer(peerConfig());
    this.peer = peer;
    peer.on('open', () => this.connect());
    peer.on('disconnected', () => { setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1000); });
    peer.on('error', err => {
      if (err.type === 'peer-unavailable') {
        this.h.onStatus('nohost');
        setTimeout(() => this.connect(), 3000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.h.onStatus('reconnecting');
        this.reconnect(2500);
      } else {
        console.warn('peer error', err.type, err);
      }
    });
  }
  connect() {
    if (!this.peer || this.peer.destroyed || this.peer.disconnected) return;
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
    this.conn = conn;
    this.lastPong = Date.now();
    conn.on('open', () => {
      this.h.onStatus('online');
      conn.send(this.h.getJoin());
    });
    conn.on('data', msg => {
      this.lastPong = Date.now();
      if (msg && msg.t !== 'pong') this.h.onMsg(msg);
    });
    conn.on('close', () => { if (this.conn === conn) { this.h.onStatus('reconnecting'); this.reconnect(1500); } });
    conn.on('error', () => { if (this.conn === conn) this.reconnect(1500); });
  }
  reconnect(delay = 0) {
    clearTimeout(this._rt);
    this._rt = setTimeout(() => {
      if (this.peer && !this.peer.destroyed && !this.peer.disconnected) this.connect();
      else { try { this.peer.destroy(); } catch (e) { /* ignore */ } this.start(); }
    }, delay);
  }
  ping() {
    if (this.conn && this.conn.open) {
      try { this.conn.send({ t: 'ping' }); } catch (e) { /* ignore */ }
      if (Date.now() - this.lastPong > 15000) { this.h.onStatus('reconnecting'); this.reconnect(); }
    }
  }
  send(msg) {
    if (this.conn && this.conn.open) { this.conn.send(msg); return true; }
    return false;
  }
}
