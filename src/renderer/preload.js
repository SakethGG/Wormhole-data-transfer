'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set(['state', 'progress', 'ping', 'toast:add', 'composer:shown']);
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
  if (paths.length) ipcRenderer.invoke('files:send', paths);
  else {
    const text = dt.getData('text/plain');
    if (text && text.trim()) ipcRenderer.invoke('msg:send', text);
  }
});
