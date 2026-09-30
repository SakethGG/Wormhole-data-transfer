'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set(['state', 'progress', 'ping', 'toast:add', 'composer:shown']);
const send = (channel) => (...args) => ipcRenderer.send(channel, ...args);
const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('bh', {
  platform: process.platform,
  getState: call('state:get'),
  sendMessage: call('msg:send'),
  pickFiles: call('files:pick'),
  pairHost: call('pair:host'),
  pairStop: call('pair:stop'),
  pairConnect: call('pair:connect'),
  manualIp: call('peer:manual-ip'),
  unpair: call('peer:unpair'),
  clearHistory: call('history:clear'),
  toggleComposer: call('composer:toggle'),
  hideComposer: call('composer:hide'),
  dragStart: send('widget:dragstart'),
  dragMove: send('widget:dragmove'),
  dragEnd: send('widget:dragend'),
  widgetMenu: call('widget:menu'),
  openDownloads: call('downloads:open'),
  toastHeight: call('toast:height'),
  toastAction: call('toast:action'),
  on(channel, cb) {
    if (EVENTS.has(channel)) ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});

// Drag-and-drop lives here because only the preload can turn a dropped File into a real path.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const dt = e.dataTransfer;
  if (!dt) return;
  const paths = [...dt.files].map((f) => webUtils.getPathForFile(f)).filter(Boolean);
  if (paths.length) return ipcRenderer.invoke('files:send', paths);
  // Drag data is only readable during the event, so read everything now.
  const lines = (raw) => String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const text = dt.getData('text/plain');
  const uris = lines(dt.getData('text/uri-list'));
  const moz = lines(dt.getData('text/x-moz-url'))[0];

  // a browser tab/link dropped here arrives as a URL: send it so it opens on the other computer
  const url = [uris[0], moz, text && text.trim()].find((u) => u && /^https?:\/\/\S+$/i.test(u));
  if (url) return ipcRenderer.invoke('link:send', url);

  // Editors such as VS Code drag a file from their sidebar as *text* (a path or file:// address),
  // not as a real file. Hand every candidate to the main process, which sends the file if it exists.
  const cands = [];
  for (const type of ['codefiles', 'resourceurls']) {
    try {
      const j = JSON.parse(dt.getData(type) || 'null');
      if (Array.isArray(j)) cands.push(...j.filter((x) => typeof x === 'string'));
    } catch { /* not JSON */ }
  }
  cands.push(...uris, ...lines(text));
  const asText = () => { if (text && text.trim()) ipcRenderer.invoke('msg:send', text); };
  if (!cands.length) return asText();
  ipcRenderer.invoke('files:send-guess', cands.slice(0, 200)).then((sent) => { if (!sent) asText(); });
});
