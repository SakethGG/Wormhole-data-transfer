'use strict';
const { EventEmitter } = require('events');
const tls = require('tls');
const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Bonjour } = require('bonjour-service');
const { encodeJson, encodeData, Decoder } = require('./framing');

const DEFAULT_PORT = 47653;
const SERVICE_TYPE = 'wormhole';
const CHUNK = 256 * 1024;
const MAX_TEXT = 4000;
const MAX_HISTORY = 50;
const PAIR_MAX_FAILURES = 5;
const PAIR_TTL_MS = 5 * 60 * 1000;
const IS_WIN = process.platform === 'win32';

const norm = (fp) => String(fp || '').replace(/:/g, '').toLowerCase();
const hmac = (code, role, a, b) =>
  crypto.createHmac('sha256', code).update(`${role}|${a}|${b}`).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const stripV6 = (ip) => String(ip || '').replace(/^::ffff:/, '');

// ---- filename handling (Windows <-> Mac safe) -----------------------------

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function sanitizeSegment(seg) {
  let s = String(seg).replace(/\0/g, '');
  if (IS_WIN) {
    s = s.normalize('NFC').replace(/[<>:"|?*\\\x01-\x1f]/g, '_').replace(/[. ]+$/, '');
    if (WIN_RESERVED.test(s)) s = '_' + s;
  }
  if (!s || s === '.' || s === '..') return null;
  return s.length > 200 ? s.slice(0, 200) : s;
}

function uniqueName(dir, name) {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = name;
  for (let n = 1; fs.existsSync(path.join(dir, candidate)); n++) candidate = `${stem} (${n})${ext}`;
  return candidate;
}

async function buildManifest(paths) {
  const items = [];
  const usedTops = new Set();
  let total = 0;
  const tops = [];

  async function walk(abs, rel) {
    const st = await fsp.lstat(abs);
    if (st.isSymbolicLink()) return;
    const meta = { p: rel, t: Math.round(st.mtimeMs) };
    if (process.platform !== 'win32') meta.m = st.mode & 0o777;
    if (st.isDirectory()) {
      items.push({ ...meta, d: 1 });
      for (const name of await fsp.readdir(abs)) await walk(path.join(abs, name), `${rel}/${name}`);
    } else if (st.isFile()) {
      items.push({ ...meta, s: st.size, abs });
      total += st.size;
    }
  }

  for (const abs of paths) {
    let top = path.basename(abs);
    if (!top) continue;
    const base = top;
    for (let n = 2; usedTops.has(top); n++) top = `${base} (${n})`;
    usedTops.add(top);
    tops.push(top);
    await walk(abs, top);
  }
  return { items, total, tops, files: items.filter((i) => !i.d).length };
}

// ---- one TLS connection ----------------------------------------------------

class Link {
  constructor(socket, weInitiated, peerFp) {
    this.socket = socket;
    this.weInitiated = weInitiated;
    this.peerFp = peerFp;
    this.ready = false;
    this.closed = false;
    this.name = '';
    this.lastSeen = Date.now();
    this.decoder = null;
  }

  send(obj) {
    if (this.closed) return;
    for (const p of encodeJson(obj)) this.socket.write(p);
  }

  async sendData(id, chunk) {
    if (this.closed) throw new Error('connection closed');
    let ok = true;
    for (const p of encodeData(id, chunk)) ok = this.socket.write(p);
    if (ok) return;
    await new Promise((resolve, reject) => {
      const onDrain = () => { this.socket.off('close', onClose); resolve(); };
      const onClose = () => { this.socket.off('drain', onDrain); reject(new Error('connection closed')); };
      this.socket.once('drain', onDrain);
      this.socket.once('close', onClose);
    });
  }

  close() {
    if (this.closed) return;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 500).unref();
  }
}

// ---- the service -----------------------------------------------------------

class PeerService extends EventEmitter {
  constructor({ identity, store, history, deviceName }) {
    super();
    this.identity = identity;
    this.store = store;
    this.history = history;
    this.deviceName = deviceName || os.hostname();
    this.port = DEFAULT_PORT;

    this.link = null;
    this.connecting = false;
    this.pairCode = null;
    this.pairFailures = 0;
    this.pairTimer = null;

    this.discovered = new Map(); // service name -> {id, name, host[], port, pair}
    this.seenMsgIds = new Set();

    this.nextId = 1 + Math.floor(Math.random() * 1e6);
    this.outgoing = new Map();
    this.incoming = new Map();
    this.sendQueue = Promise.resolve();
    this.offerHandler = null; // async ({label, files, total}) => boolean
    this.rotate = 0;
  }

  // ---------- lifecycle ----------

  async start() {
    this.server = tls.createServer(
      { key: this.identity.key, cert: this.identity.cert, requestCert: true, rejectUnauthorized: false },
      (sock) => this._adopt(sock, false),
    );
    await new Promise((resolve) => {
      const tryListen = (port) => {
        this.server.once('error', (e) => {
          if (e.code === 'EADDRINUSE' && port !== 0) tryListen(0);
          else { this.emit('notice', { level: 'error', text: `Cannot listen: ${e.message}` }); resolve(); }
        });
        this.server.listen(port, () => {
          this.port = this.server.address().port;
          this.server.removeAllListeners('error');
          this.server.on('error', () => {});
          resolve();
        });
      };
      tryListen(DEFAULT_PORT);
    });

    this._startDiscovery();
    this.tickTimer = setInterval(() => this._tick(), 3000);
    this.beatTimer = setInterval(() => this._heartbeat(), 5000);
    this.refreshTimer = setInterval(() => { try { this.browser && this.browser.update(); } catch { /* ignore */ } }, 30000);
    this._tick();
  }

  stop() {
    clearInterval(this.tickTimer);
    clearInterval(this.beatTimer);
    clearInterval(this.refreshTimer);
    try { this.link && this.link.socket.destroy(); } catch { /* ignore */ }
    try { this.server && this.server.close(); } catch { /* ignore */ }
    try { this.bonjour && this.bonjour.unpublishAll(() => this.bonjour.destroy()); } catch { /* ignore */ }
  }

  // ---------- state ----------

  getState() {
    const peer = this.store.get('peer');
    let status = 'unpaired';
    if (peer) status = this.link && this.link.ready ? 'online' : this.connecting ? 'connecting' : 'offline';
    return {
      status,
      peerName: peer ? peer.name : null,
      ownName: this.deviceName,
      pairCode: this.pairCode,
      discovered: [...this.discovered.values()].filter((d) => d.pair && d.id !== this._ownId()),
      port: this.port,
    };
  }

  _emitState() { this.emit('state', this.getState()); }
  _ownId() { return this.identity.fp.slice(0, 16); }

  // ---------- discovery ----------

  _startDiscovery() {
    try {
      // mDNS errors (e.g. EHOSTUNREACH on 224.0.0.251 with a VPN/virtual adapter) must not crash the app.
      const onMdnsError = (err) => {
        if (this._mdnsWarned) return;
        this._mdnsWarned = true;
        this.emit('notice', { level: 'warn', text: `LAN discovery problem (${err.message}). If the other computer is not listed, enter its IP manually.` });
      };
      this.bonjour = new Bonjour({}, onMdnsError);
      try { this.bonjour.server.mdns.on('error', onMdnsError); } catch { /* ignore */ }
      this._publish();
      this.browser = this.bonjour.find({ type: SERVICE_TYPE });
      const onUp = (svc) => {
        const id = svc.txt && svc.txt.id;
        if (!id || id === this._ownId()) return;
        const hosts = (svc.addresses || []).filter((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
        this.discovered.set(svc.name, {
          key: svc.name, id, name: (svc.txt && svc.txt.name) || svc.host, host: hosts, port: svc.port,
          pair: svc.txt && svc.txt.pair === '1',
        });
        this._emitState();
      };
      this.browser.on('up', onUp);
      this.browser.on('down', (svc) => { this.discovered.delete(svc.name); this._emitState(); });
    } catch (e) {
      this.emit('notice', { level: 'warn', text: `LAN discovery unavailable (${e.message}). Enter the IP manually.` });
    }
  }

  _publish() {
    if (!this.bonjour) return;
    try {
      if (this.service) this.service.stop();
      this.service = this.bonjour.publish({
        name: `Wormhole-${this._ownId().slice(0, 8)}`,
        type: SERVICE_TYPE,
        port: this.port,
        txt: { id: this._ownId(), name: this.deviceName, pair: this.pairCode ? '1' : '0' },
      });
    } catch { /* discovery is best effort */ }
  }

  // ---------- pairing ----------

  startPairHost() {
    this.pairCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    this.pairFailures = 0;
    clearTimeout(this.pairTimer);
    this.pairTimer = setTimeout(() => this.stopPairHost(), PAIR_TTL_MS);
    this._publish();
    this._emitState();
    return this.pairCode;
  }

  stopPairHost() {
    clearTimeout(this.pairTimer);
    if (!this.pairCode) return;
    this.pairCode = null;
    this._publish();
    this._emitState();
  }

  /** Connect to a PC that is showing a pairing code. host may be "ip" or "ip:port". */
  pairWith(hostSpec, code, port) {
    let host = hostSpec;
    let p = port || DEFAULT_PORT;
    const m = /^(.+):(\d+)$/.exec(hostSpec);
    if (m) { host = m[1]; p = Number(m[2]); }
    return new Promise((resolve, reject) => {
      this._connect(host, p, 'pair', String(code).trim(), { resolve, reject });
    });
  }

  unpair() {
    this.store.set('peer', null);
    if (this.link) this.link.close();
    this._emitState();
  }

  // ---------- connecting ----------

  _tick() {
    const peer = this.store.get('peer');
    if (!peer || this.connecting || (this.link && this.link.ready)) return;
    const wantId = peer.fp.slice(0, 16);
    const cands = [];
    for (const d of this.discovered.values()) {
      if (d.id === wantId) for (const h of d.host) cands.push({ host: h, port: d.port });
    }
    if (peer.ip) cands.push({ host: peer.ip, port: peer.port || DEFAULT_PORT });
    if (!cands.length) return;
    const c = cands[this.rotate++ % cands.length];
    this._connect(c.host, c.port, 'session');
  }

  /** Manually point at the other PC's IP (used when discovery is blocked). */
  connectManual(hostSpec) {
    const peer = this.store.get('peer');
    if (!peer) throw new Error('Pair first');
    const m = /^(.+):(\d+)$/.exec(hostSpec);
    const host = m ? m[1] : hostSpec;
    const port = m ? Number(m[2]) : DEFAULT_PORT;
    this.store.set('peer', { ...peer, ip: host, port });
    this._tick();
  }

  _connect(host, port, intent, code, pairPromise) {
    if (intent === 'session') { this.connecting = true; this._emitState(); }
    const sock = tls.connect({
      host, port,
      key: this.identity.key, cert: this.identity.cert,
      rejectUnauthorized: false,
      timeout: 5000,
    });
    let link = null;
    const fail = (err) => {
      if (intent === 'session') { this.connecting = false; this._emitState(); }
      if (pairPromise && !pairPromise.done) { pairPromise.done = true; pairPromise.reject(err); }
    };
    sock.once('timeout', () => { if (!link || !link.ready) { sock.destroy(); fail(new Error('Timed out')); } });
    sock.once('error', (e) => { fail(new Error(e.code === 'ECONNREFUSED' ? 'Other PC is not reachable (is Wormhole running there?)' : e.message)); });
    sock.once('secureConnect', () => {
      sock.setTimeout(0);
      const peerFp = norm(sock.getPeerCertificate().fingerprint256);
      const peer = this.store.get('peer');
      if (intent === 'session' && (!peer || peerFp !== peer.fp)) { sock.destroy(); fail(new Error('Certificate mismatch')); return; }
      link = this._adopt(sock, true, peerFp);
      link.intent = intent;
      link.code = code;
      link.pairPromise = pairPromise;
      link.remoteHost = host;
      link.remotePort = port;
      link.send({
        t: 'hello', name: this.deviceName, intent, port: this.port,
        proof: intent === 'pair' ? hmac(code, 'C', this.identity.fp, peerFp) : undefined,
      });
    });
  }

  _adopt(sock, weInitiated, knownPeerFp) {
    const peerFp = knownPeerFp || norm(sock.getPeerCertificate().fingerprint256);
    if (!peerFp) { sock.destroy(); return null; }
    const link = new Link(sock, weInitiated, peerFp);
    link.remoteHost = stripV6(sock.remoteAddress);
    link.decoder = new Decoder(
      (msg) => this._onFrame(link, msg),
      (id, chunk) => this._onData(link, id, chunk),
    );
    sock.on('data', (buf) => {
      link.lastSeen = Date.now();
      try { link.decoder.push(buf); } catch { sock.destroy(); }
    });
    sock.on('close', () => this._onClose(link));
    sock.on('error', () => {});
    if (!weInitiated) sock.setTimeout(10000, () => { if (!link.ready) sock.destroy(); });
    return link;
  }

  // ---------- protocol ----------

  _onFrame(link, msg) {
    if (!link.ready) return this._onHandshakeFrame(link, msg);
    switch (msg.t) {
      case 'ping': return link.send({ t: 'pong' });
      case 'pong': return;
      case 'msg': return this._onMessage(link, msg);
      case 'ack': return this._onAck(msg);
      case 'offer': return this._onOffer(link, msg);
      case 'accept': case 'reject': return this._resolveOffer(msg);
      case 'items': return this._onItems(msg);
      case 'items-end': return this._onItemsEnd(link, msg);
      case 'fstart': return this._onFileStart(link, msg);
      case 'fend': return this._onFileEnd(msg);
      case 'done': return this._onDone(link, msg);
      case 'received': return this._onReceivedAck(msg);
      case 'cancel': return this._onCancel(msg);
      default: return;
    }
  }

  _onHandshakeFrame(link, msg) {
    const peer = this.store.get('peer');
    if (!link.weInitiated) {
      // We are the listener; the first frame must be the client's hello.
      if (msg.t !== 'hello') return link.socket.destroy();
      if (msg.intent === 'session') {
        if (peer && peer.fp === link.peerFp) {
          link.name = peer.name;
          link.send({ t: 'welcome', name: this.deviceName });
          this._ready(link, msg.port);
        } else {
          link.send({ t: 'reject', reason: 'not-paired' });
          link.close();
        }
      } else if (msg.intent === 'pair') {
        if (!this.pairCode) { link.send({ t: 'reject', reason: 'not-pairing' }); return link.close(); }
        const expect = hmac(this.pairCode, 'C', link.peerFp, this.identity.fp);
        if (!safeEq(expect, msg.proof || '')) {
          link.send({ t: 'reject', reason: 'bad-code' });
          link.close();
          if (++this.pairFailures >= PAIR_MAX_FAILURES) this.stopPairHost();
          return;
        }
        const code = this.pairCode;
        link.name = String(msg.name || 'Other PC').slice(0, 60);
        this.store.set('peer', { fp: link.peerFp, name: link.name, ip: link.remoteHost, port: msg.port || DEFAULT_PORT });
        link.send({ t: 'pair-ok', name: this.deviceName, proof: hmac(code, 'S', this.identity.fp, link.peerFp) });
        this.stopPairHost();
        this.emit('paired', link.name);
        this._ready(link, msg.port);
      } else {
        link.socket.destroy();
      }
      return;
    }
    // We are the client.
    if (msg.t === 'welcome' && link.intent === 'session') {
      link.name = msg.name || (peer && peer.name) || 'Other PC';
      this._ready(link);
    } else if (msg.t === 'pair-ok' && link.intent === 'pair') {
      const expect = hmac(link.code, 'S', link.peerFp, this.identity.fp);
      if (!safeEq(expect, msg.proof || '')) {
        link.socket.destroy();
        return this._pairSettle(link, new Error('Pairing verification failed'));
      }
      link.name = String(msg.name || 'Other PC').slice(0, 60);
      this.store.set('peer', { fp: link.peerFp, name: link.name, ip: link.remoteHost, port: link.remotePort });
      this.emit('paired', link.name);
      this._pairSettle(link, null);
      this._ready(link);
    } else if (msg.t === 'reject') {
      const reasons = { 'bad-code': 'Wrong code', 'not-pairing': 'That PC is not showing a pairing code', 'not-paired': 'That PC is not paired with this one' };
      this._pairSettle(link, new Error(reasons[msg.reason] || 'Rejected'));
      link.close();
    }
  }

  _pairSettle(link, err) {
    const p = link.pairPromise;
    if (!p || p.done) return;
    p.done = true;
    if (err) p.reject(err); else p.resolve();
  }

  _ready(link, peerListenPort) {
    const cur = this.link;
    if (cur && cur.ready && !cur.closed) {
      const initOf = (l) => (l.weInitiated ? this.identity.fp : l.peerFp);
      const a = initOf(link);
      const b = initOf(cur);
      const keepNew = a === b || a < b;
      if (!keepNew) { link.close(); return; }
      cur.replaced = true;
      cur.close();
    }
    link.ready = true;
    link.socket.setTimeout(0);
    this.link = link;
    this.connecting = false;
    const peer = this.store.get('peer');
    if (peer) {
      const port = link.weInitiated ? link.remotePort : peerListenPort || peer.port;
      this.store.set('peer', { ...peer, name: link.name || peer.name, ip: link.remoteHost, port });
    }
    this._emitState();
    this._flushOutbox();
  }

  _onClose(link) {
    link.closed = true;
    if (link.pairPromise) this._pairSettle(link, new Error('Connection closed'));
    if (this.link === link) {
      this.link = null;
      this._dropTransfers('Connection lost');
    }
    if (link.weInitiated && link.intent === 'session') this.connecting = false;
    this._emitState();
  }

  _heartbeat() {
    const l = this.link;
    if (!l || !l.ready) return;
    if (Date.now() - l.lastSeen > 25000) return l.socket.destroy();
    l.send({ t: 'ping' });
  }

  // ---------- messages ----------

  sendMessage(text, kind = 'text') {
    text = String(text || '').trim().slice(0, MAX_TEXT);
    if (!text) return null;
    const m = { id: crypto.randomUUID(), text, ts: Date.now(), dir: 'out', kind, delivered: false };
    this._pushHistory(m);
    if (this.link && this.link.ready) this.link.send({ t: 'msg', id: m.id, text: m.text, ts: m.ts, kind });
    return m;
  }

  _flushOutbox() {
    for (const m of this.history.get('messages')) {
      if (m.dir === 'out' && !m.delivered) this.link.send({ t: 'msg', id: m.id, text: m.text, ts: m.ts, kind: m.kind });
    }
  }

  _pushHistory(m) {
    const list = this.history.get('messages');
    list.push(m);
    while (list.length > MAX_HISTORY) list.shift();
    this.history.save();
    this.emit('history', list);
  }

  _onMessage(link, msg) {
    link.send({ t: 'ack', id: msg.id });
    if (this.seenMsgIds.has(msg.id)) return;
    this.seenMsgIds.add(msg.id);
    if (this.seenMsgIds.size > 500) this.seenMsgIds.delete(this.seenMsgIds.values().next().value);
    const m = { id: msg.id, text: String(msg.text || '').slice(0, MAX_TEXT), ts: Date.now(), dir: 'in', kind: msg.kind === 'clip' || msg.kind === 'link' ? msg.kind : 'text' };
    this._pushHistory(m);
    this.emit('message', m, link.name);
  }

  _onAck(msg) {
    const list = this.history.get('messages');
    const m = list.find((x) => x.id === msg.id);
    if (m && !m.delivered) {
      m.delivered = true;
      this.history.save();
      this.emit('history', list);
    }
  }

  clearHistory() {
    this.history.set('messages', []);
    this.emit('history', []);
  }

  // ---------- sending files ----------

  sendPaths(paths) {
    if (!(this.link && this.link.ready)) {
      this.emit('notice', { level: 'warn', text: 'Other PC is offline. Files were not sent.' });
      return false;
    }
    const link = this.link;
    this.sendQueue = this.sendQueue
      .then(() => this._sendBatch(link, paths))
      .catch((e) => this.emit('notice', { level: 'error', text: `Send failed: ${e.message}` }));
    return true;
  }

  async _sendBatch(link, paths) {
    if (link.closed) throw new Error('connection closed');
    const man = await buildManifest(paths);
    if (!man.items.length) throw new Error('Nothing to send');
    const id = this.nextId++;
    const label = man.tops.length > 1 ? `${man.tops[0]} +${man.tops.length - 1} more` : man.tops[0];
    const st = { id, label, total: man.total, done: 0, cancelled: false, link, lastEmit: 0 };
    this.outgoing.set(id, st);
    try {
      const accepted = await new Promise((resolve, reject) => {
        st.resolveOffer = resolve;
        st.rejectOffer = reject;
        st.offerTimer = setTimeout(() => reject(new Error('No response from other PC')), 120000);
        link.send({ t: 'offer', id, label, files: man.files, total: man.total });
      });
      clearTimeout(st.offerTimer);
      if (!accepted) throw new Error('Other PC declined the transfer');

      for (let i = 0; i < man.items.length; i += 500) {
        link.send({
          t: 'items', id,
          list: man.items.slice(i, i + 500).map(({ abs, ...meta }) => meta),
        });
      }
      link.send({ t: 'items-end', id });

      this._progress(st, true);
      for (let i = 0; i < man.items.length; i++) {
        const it = man.items[i];
        if (it.d) continue;
        link.send({ t: 'fstart', id, i });
        for await (const chunk of fs.createReadStream(it.abs, { highWaterMark: CHUNK })) {
          if (st.cancelled) throw new Error('Cancelled');
          await link.sendData(id, chunk);
          st.done += chunk.length;
          this._progress(st);
        }
        link.send({ t: 'fend', id, i });
      }
      link.send({ t: 'done', id });
      await new Promise((resolve, reject) => {
        st.resolveDone = resolve;
        st.rejectDone = reject;
        setTimeout(() => reject(new Error('Other PC did not confirm')), 60000).unref();
      });
      this._progress(st, true, true);
      this.emit('sent', { label, files: man.files });
    } catch (e) {
      if (!st.cancelled) link.send({ t: 'cancel', id });
      this._progress(st, true, true);
      throw e;
    } finally {
      clearTimeout(st.offerTimer);
      this.outgoing.delete(id);
    }
  }

  _resolveOffer(msg) {
    const st = this.outgoing.get(msg.id);
    if (st && st.resolveOffer) st.resolveOffer(msg.t === 'accept');
  }

  _onReceivedAck(msg) {
    const st = this.outgoing.get(msg.id);
    if (st && st.resolveDone) st.resolveDone();
  }

  _progress(st, force = false, finished = false) {
    const now = Date.now();
    if (!force && now - st.lastEmit < 80) return;
    st.lastEmit = now;
    this.emit('progress', { id: st.id, dir: st.dir || 'out', label: st.label, done: st.done, total: st.total, finished });
  }

  // ---------- receiving files ----------

  async _onOffer(link, msg) {
    const st = {
      id: msg.id, dir: 'in', label: String(msg.label || 'files').slice(0, 120), total: Number(msg.total) || 0,
      files: Number(msg.files) || 0, done: 0, items: [], link, lastEmit: 0, ends: [], cur: null, topMap: null,
    };
    let ok = true;
    if (!this.store.get('autoAccept') && this.offerHandler) {
      try { ok = await this.offerHandler({ label: st.label, files: st.files, total: st.total, from: link.name }); } catch { ok = false; }
    }
    if (link.closed) return;
    if (!ok) return link.send({ t: 'reject', id: msg.id });
    this.incoming.set(msg.id, st);
    link.send({ t: 'accept', id: msg.id });
  }

  _onItems(msg) {
    const st = this.incoming.get(msg.id);
    if (st) for (const it of msg.list || []) st.items.push(it);
  }

  _onItemsEnd(link, msg) {
    const st = this.incoming.get(msg.id);
    if (!st) return;
    try {
      const base = this.store.get('downloadDir');
      fs.mkdirSync(base, { recursive: true });
      st.base = base;
      st.topMap = new Map();
      for (const it of st.items) {
        const segs = String(it.p).split('/').map(sanitizeSegment);
        if (segs.some((s) => s === null)) throw new Error('Unsafe path in transfer');
        if (!st.topMap.has(segs[0])) st.topMap.set(segs[0], uniqueName(base, segs[0]));
        segs[0] = st.topMap.get(segs[0]);
        it.dest = path.join(base, ...segs);
        if (!path.resolve(it.dest).startsWith(path.resolve(base) + path.sep)) throw new Error('Unsafe path in transfer');
        if (it.d) fs.mkdirSync(it.dest, { recursive: true });
      }
      st.ready = true;
      this._progress(st, true);
    } catch (e) {
      this.emit('notice', { level: 'error', text: `Receive failed: ${e.message}` });
      this._abortIncoming(st, true);
    }
  }

  _onFileStart(link, msg) {
    const st = this.incoming.get(msg.id);
    if (!st || !st.ready) return;
    const it = st.items[msg.i];
    if (!it || it.d) return;
    try { fs.mkdirSync(path.dirname(it.dest), { recursive: true }); } catch { /* ignore */ }
    const ws = fs.createWriteStream(it.dest);
    ws.on('error', (e) => {
      this.emit('notice', { level: 'error', text: `Write failed: ${e.message}` });
      this._abortIncoming(st, true);
    });
    st.cur = { ws, it };
  }

  _onData(link, id, chunk) {
    const st = this.incoming.get(id);
    if (!st || !st.cur) return;
    st.done += chunk.length;
    if (!st.cur.ws.write(chunk)) {
      link.socket.pause();
      st.cur.ws.once('drain', () => link.socket.resume());
    }
    this._progress(st);
  }

  _onFileEnd(msg) {
    const st = this.incoming.get(msg.id);
    if (!st || !st.cur) return;
    const { ws, it } = st.cur;
    st.cur = null;
    st.ends.push(new Promise((resolve) => {
      ws.end(() => {
        try {
          if (it.m !== undefined && !IS_WIN) fs.chmodSync(it.dest, it.m & 0o777);
          if (it.t) fs.utimesSync(it.dest, new Date(), new Date(it.t));
        } catch { /* best effort */ }
        resolve();
      });
    }));
  }

  async _onDone(link, msg) {
    const st = this.incoming.get(msg.id);
    if (!st) return;
    await Promise.all(st.ends);
    // restore folder mtimes after their contents are written
    for (const it of st.items) {
      if (it.d && it.t) { try { fs.utimesSync(it.dest, new Date(), new Date(it.t)); } catch { /* ignore */ } }
    }
    this.incoming.delete(msg.id);
    link.send({ t: 'received', id: msg.id });
    this._progress(st, true, true);
    const first = st.items.length ? st.items[0].dest : st.base;
    this.emit('received', { label: st.label, files: st.files, base: st.base, first, from: link.name });
  }

  _abortIncoming(st, notifyPeer) {
    if (st.cur) { try { st.cur.ws.destroy(); fs.unlink(st.cur.it.dest, () => {}); } catch { /* ignore */ } st.cur = null; }
    this.incoming.delete(st.id);
    if (notifyPeer && !st.link.closed) st.link.send({ t: 'cancel', id: st.id });
    this._progress(st, true, true);
  }

  // ---------- cancel / cleanup ----------

  _onCancel(msg) {
    const out = this.outgoing.get(msg.id);
    if (out) {
      out.cancelled = true;
      if (out.rejectOffer) out.rejectOffer(new Error('Cancelled by other PC'));
      if (out.rejectDone) out.rejectDone(new Error('Cancelled by other PC'));
    }
    const inc = this.incoming.get(msg.id);
    if (inc) this._abortIncoming(inc, false);
  }

  cancelAll() {
    for (const st of this.outgoing.values()) {
      st.cancelled = true;
      if (st.rejectOffer) st.rejectOffer(new Error('Cancelled'));
      if (st.rejectDone) st.rejectDone(new Error('Cancelled'));
      if (st.link && !st.link.closed) st.link.send({ t: 'cancel', id: st.id });
    }
    for (const st of [...this.incoming.values()]) this._abortIncoming(st, true);
  }

  _dropTransfers(reason) {
    for (const st of this.outgoing.values()) {
      st.cancelled = true;
      if (st.rejectOffer) st.rejectOffer(new Error(reason));
      if (st.rejectDone) st.rejectDone(new Error(reason));
    }
    for (const st of [...this.incoming.values()]) {
      this._abortIncoming(st, false);
      this.emit('notice', { level: 'warn', text: `Transfer of "${st.label}" was interrupted` });
    }
  }
}

module.exports = { PeerService, DEFAULT_PORT };
