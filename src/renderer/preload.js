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
  // a browser tab/link dropped here arrives as a URL: send it so it opens on the other computer
  const uri = (dt.getData('text/uri-list') || '').split(/\r?\n/).find((l) => l && !l.startsWith('#'));
  const moz = (dt.getData('text/x-moz-url') || '').split(/\r?\n/)[0];
  const text = dt.getData('text/plain');
  const url = [uri, moz, text && text.trim()].find((u) => u && /^https?:\/\/\S+$/i.test(u.trim()));
  if (url) ipcRenderer.invoke('link:send', url.trim());
  else if (text && text.trim()) ipcRenderer.invoke('msg:send', text);
});
