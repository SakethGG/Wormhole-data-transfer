'use strict';
// Headless end-to-end test: two peers in one process pair, chat, and transfer a folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { PeerService } = require('../src/net/peer');
const { loadOrCreate } = require('../src/net/identity');
const { JsonStore, DEFAULTS } = require('../src/main/config');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-test-'));
function makePeer(name) {
  const dir = path.join(tmp, name);
  const store = new JsonStore(path.join(dir, 'config.json'), { ...DEFAULTS, downloadDir: path.join(dir, 'dl') });
  const history = new JsonStore(path.join(dir, 'history.json'), { messages: [] });
  return new PeerService({ identity: loadOrCreate(dir), store, history, deviceName: name });
}
const once = (em, ev) => new Promise((r) => em.once(ev, r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const a = makePeer('A');
  const b = makePeer('B');
  await a.start();
  await b.start();
  console.log('ports', a.port, b.port);

  // wrong code must fail
  const code = a.startPairHost();
  await assert.rejects(b.pairWith(`127.0.0.1:${a.port}`, '000000' === code ? '111111' : '000000'), /Wrong code/);
  console.log('ok: wrong code rejected');

  await b.pairWith(`127.0.0.1:${a.port}`, code);
  await wait(300);
  assert.strictEqual(a.getState().status, 'online');
  assert.strictEqual(b.getState().status, 'online');
  console.log('ok: paired and online');

  // messages both ways + queueing while offline
  const got = once(b, 'message');
  a.sendMessage('hello from A');
  assert.strictEqual((await got).text, 'hello from A');
  const got2 = once(a, 'message');
  b.sendMessage('hi back');
  assert.strictEqual((await got2).text, 'hi back');
  await wait(200);
  assert.ok(a.history.get('messages').find((m) => m.text === 'hello from A').delivered);
  console.log('ok: messages + ack');

  // folder transfer
  const src = path.join(tmp, 'src', 'My Folder');
  fs.mkdirSync(path.join(src, 'sub', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(src, 'empty'));
  fs.writeFileSync(path.join(src, 'a.txt'), 'hello');
  fs.writeFileSync(path.join(src, 'sub', 'deep', 'big.bin'), require('crypto').randomBytes(5 * 1024 * 1024 + 123));
  fs.writeFileSync(path.join(src, 'zero.txt'), '');
  const single = path.join(tmp, 'src', 'single.txt');
  fs.writeFileSync(single, 'single file');

  const recv = once(b, 'received');
  a.sendPaths([src, single]);
  const r = await recv;
  console.log('received', r.label, r.files);
  const dl = path.join(tmp, 'B', 'dl');
  assert.strictEqual(fs.readFileSync(path.join(dl, 'My Folder', 'a.txt'), 'utf8'), 'hello');
  assert.ok(fs.statSync(path.join(dl, 'My Folder', 'empty')).isDirectory());
  assert.strictEqual(fs.statSync(path.join(dl, 'My Folder', 'zero.txt')).size, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(dl, 'My Folder', 'sub', 'deep', 'big.bin')).compare(
      fs.readFileSync(path.join(src, 'sub', 'deep', 'big.bin'))), 0);
  assert.strictEqual(fs.readFileSync(path.join(dl, 'single.txt'), 'utf8'), 'single file');
  console.log('ok: folder + file transfer');

  // same again -> collision suffix
  const recv2 = once(b, 'received');
  a.sendPaths([single]);
  await recv2;
  assert.ok(fs.existsSync(path.join(dl, 'single (1).txt')));
  console.log('ok: collision rename');

  // reverse direction file
  const recv3 = once(a, 'received');
  b.sendPaths([single]);
  await recv3;
  console.log('ok: reverse transfer');

  // offline queueing + reconnect
  b.link.socket.destroy();
  await wait(200);
  a.sendMessage('queued while offline');
  const got3 = once(b, 'message');
  // a's tick reconnects via stored ip:port
  a._tick(); b._tick();
  const m3 = await Promise.race([got3, wait(15000).then(() => null)]);
  assert.ok(m3 && m3.text === 'queued while offline');
  console.log('ok: reconnect + queued delivery');

  a.stop(); b.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ALL PASSED');
  process.exit(0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
