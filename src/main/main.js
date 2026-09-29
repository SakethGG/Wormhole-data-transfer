'use strict';
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, dialog, shell, clipboard, globalShortcut, nativeImage,
} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { JsonStore, DEFAULTS } = require('./config');
const { loadOrCreate } = require('../net/identity');
const { PeerService } = require('../net/peer');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(RENDERER, 'preload.js');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

const WIDGET = 80;
const WIDGET_DESIGN = 110; // the widget artwork is laid out at this size and scaled down with zoom
const MARGIN = 12;
const GAP = 8;
const COMPOSER = { w: 350, h: 540 };
const TOAST_W = 360;
const CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

app.setAppUserModelId('com.wormhole.app');
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let store; let history; let peer;
let widget; let composer; let toast; let tray;
let toastHeight = 0;
let suppressBlur = false;
let quitting = false;
let lastBlurHide = 0;

// ---------- windows ----------

function baseWindow(opts) {
  const win = new BrowserWindow({
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false },
    ...opts,
  });
  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true, IS_MAC ? 'floating' : 'screen-saver');
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
  return win;
}

function clampToDisplay(x, y) {
  const wa = screen.getDisplayNearestPoint({ x: Math.round(x + WIDGET / 2), y: Math.round(y + WIDGET / 2) }).workArea;
  return {
    x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - WIDGET)),
    y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - WIDGET)),
  };
}

function widgetBounds() {
  const pos = store.get('pos');
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    return { ...clampToDisplay(pos.x, pos.y), width: WIDGET, height: WIDGET };
  }
  const wa = screen.getPrimaryDisplay().workArea;
  const c = store.get('corner');
  return {
    x: c.endsWith('right') ? wa.x + wa.width - WIDGET - MARGIN : wa.x + MARGIN,
    y: c.startsWith('bottom') ? wa.y + wa.height - WIDGET - MARGIN : wa.y + MARGIN,
    width: WIDGET,
    height: WIDGET,
  };
}

/** Which side of its screen the widget sits on decides which way panels grow. */
function anchor() {
  const wb = widget && !widget.isDestroyed() ? widget.getBounds() : widgetBounds();
  const wa = screen.getDisplayNearestPoint({ x: wb.x + WIDGET / 2, y: wb.y + WIDGET / 2 }).workArea;
  return {
    right: wb.x + WIDGET / 2 > wa.x + wa.width / 2,
    bottom: wb.y + WIDGET / 2 > wa.y + wa.height / 2,
    wa,
  };
}

/** Bounds for a panel of the given size stacked next to the widget, growing away from the screen edge. */
function panelBounds(width, height) {
  const wb = widgetBounds();
  const a = anchor();
  const x = a.right ? wb.x + WIDGET - width : wb.x;
  const y = a.bottom ? wb.y - GAP - height : wb.y + WIDGET + GAP;
  return { x: Math.max(a.wa.x, x), y, width, height };
}

function createWidget() {
  widget = baseWindow({ width: WIDGET, height: WIDGET, focusable: true });
  widget.setBounds(widgetBounds());
  widget.loadFile(path.join(RENDERER, 'widget.html'));
  widget.webContents.on('did-finish-load', () => widget.webContents.setZoomFactor(WIDGET / WIDGET_DESIGN));
  widget.once('ready-to-show', () => widget.showInactive());
}

function createComposer() {
  composer = baseWindow({ width: COMPOSER.w, height: COMPOSER.h, transparent: true });
  composer.loadFile(path.join(RENDERER, 'composer.html'));
  composer.on('blur', () => {
    if (suppressBlur) return;
    if (composer.isVisible()) { lastBlurHide = Date.now(); composer.hide(); }
  });
}

function createToast() {
  toast = baseWindow({ width: TOAST_W, height: 80, focusable: false });
  toast.webContents.setBackgroundThrottling(false);
  toast.setIgnoreMouseEvents(false);
  toast.loadFile(path.join(RENDERER, 'toast.html'));
}

function showComposer() {
  composer.setBounds(panelBounds(COMPOSER.w, COMPOSER.h));
  composer.show();
  composer.focus();
  composer.webContents.send('composer:shown');
}

function toggleComposer() {
  if (composer.isVisible()) return composer.hide();
  if (Date.now() - lastBlurHide < 250) return; // the click that blurred it should not reopen it
  showComposer();
}

function positionToast() {
  if (!toastHeight) { toast.hide(); return; }
  const b = panelBounds(TOAST_W, toastHeight);
  // toasts sit on the widget's inner side; when the composer is open they stack beyond it
  if (composer.isVisible()) {
    b.y = anchor().bottom ? b.y - COMPOSER.h - GAP : b.y + COMPOSER.h + GAP;
  }
  toast.setBounds(b);
  if (!toast.isVisible()) toast.showInactive();
}

function applyCorner() {
  widget.setBounds(widgetBounds());
  if (composer.isVisible()) composer.setBounds(panelBounds(COMPOSER.w, COMPOSER.h));
  positionToast();
}

// ---------- state ----------

function snapshot() {
  return {
    ...peer.getState(),
    history: history.get('messages'),
    config: {
      corner: store.get('corner'),
      autoAccept: store.get('autoAccept'),
      downloadDir: store.get('downloadDir'),
      openAtLogin: store.get('openAtLogin'),
    },
  };
}

function broadcast(channel, payload) {
  for (const w of [widget, composer, toast]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function pushState() {
  if (quitting) return; // windows are being destroyed
  broadcast('state', snapshot());
  rebuildTray();
}

function showToast(item) {
  if (!toast || toast.isDestroyed()) return;
  // where the icon sits relative to the card, so the card can grow out of it and shrink back into it
  const a = anchor();
  const origin = `${a.right ? TOAST_W - WIDGET / 2 : WIDGET / 2}px ${a.bottom ? '100%' : '0%'}`;
  toast.webContents.send('toast:add', { ...item, origin });
}

// ---------- autostart ----------

function launchAgentPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.wormhole.app.plist');
}

function setAutostart(on) {
  store.set('openAtLogin', on);
  try {
    if (IS_MAC && !app.isPackaged) {
      // unpackaged: launch the local Electron binary against this folder via a LaunchAgent
      const file = launchAgentPath();
      if (!on) { fs.rmSync(file, { force: true }); return; }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.wormhole.app</string>
<key>ProgramArguments</key><array><string>${process.execPath}</string><string>${ROOT}</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
`);
    } else {
      app.setLoginItemSettings({
        openAtLogin: on,
        path: process.execPath,
        args: app.isPackaged ? [] : [ROOT],
      });
    }
  } catch (e) {
    showToast({ id: 'autostart', kind: 'info', title: 'Could not change startup setting', body: e.message });
  }
}

// ---------- tray ----------

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
  return img.isEmpty() ? img : img.resize({ width: IS_MAC ? 18 : 16, height: IS_MAC ? 18 : 16 });
}

function statusLabel() {
  const s = peer.getState();
  return {
    unpaired: 'Not paired yet',
    offline: `${s.peerName || 'Other PC'}: offline`,
    connecting: `${s.peerName || 'Other PC'}: connecting…`,
    online: `${s.peerName || 'Other PC'}: connected`,
  }[s.status];
}

function buildMenu() {
  const s = peer.getState();
  return Menu.buildFromTemplate([
    { label: statusLabel(), enabled: false },
    { type: 'separator' },
    { label: 'Open Wormhole', click: showComposer },
    { label: widget.isVisible() ? 'Hide portal' : 'Show portal', click: () => (widget.isVisible() ? widget.hide() : widget.showInactive()) },
    { label: 'Send clipboard text', enabled: s.status === 'online', click: sendClipboard },
    { label: 'Cancel transfers', click: () => peer.cancelAll() },
    { type: 'separator' },
    { label: 'Open received files folder', click: openDownloads },
    { label: 'Change receive folder…', click: chooseDownloadDir },
    { label: 'Open received links automatically', type: 'checkbox', checked: !!store.get('openLinks'), click: (i) => { store.set('openLinks', i.checked); pushState(); } },
    { label: 'Auto-accept incoming files', type: 'checkbox', checked: store.get('autoAccept'), click: (i) => { store.set('autoAccept', i.checked); pushState(); } },
    {
      label: 'Corner',
      submenu: CORNERS.map((c) => ({
        label: c.replace('-', ' '), type: 'radio', checked: !store.get('pos') && store.get('corner') === c,
        click: () => { store.set('pos', null); store.set('corner', c); applyCorner(); pushState(); },
      })),
    },
    { label: 'Start when I log in', type: 'checkbox', checked: !!store.get('openAtLogin'), click: (i) => { setAutostart(i.checked); pushState(); } },
    { type: 'separator' },
    { label: 'Pair with a different PC…', click: () => { peer.unpair(); showComposer(); } },
    { label: 'Quit Wormhole', click: () => app.quit() },
  ]);
}

function rebuildTray() {
  if (!tray || tray.isDestroyed() || quitting) return;
  tray.setToolTip(`Wormhole · ${statusLabel()}`);
  tray.setContextMenu(buildMenu());
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.on('click', () => { if (!IS_MAC) toggleComposer(); });
  rebuildTray();
}

// ---------- actions ----------

function openDownloads() {
  const dir = store.get('downloadDir');
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
}

async function chooseDownloadDir() {
  suppressBlur = true;
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], defaultPath: store.get('downloadDir') });
  suppressBlur = false;
  if (!r.canceled && r.filePaths[0]) { store.set('downloadDir', r.filePaths[0]); pushState(); }
}

/** Only plain http(s) links are ever opened automatically. */
function isWebUrl(u) {
  try { const p = new URL(String(u)); return p.protocol === 'http:' || p.protocol === 'https:'; } catch { return false; }
}

function sendClipboard() {
  const text = clipboard.readText();
  if (!text.trim()) return showToast({ id: 'clip', kind: 'info', title: 'Clipboard is empty', body: 'Copy some text first.' });
  peer.sendMessage(text, 'clip');
  showToast({ id: 'clip', kind: 'info', title: 'Clipboard sent', body: text.length > 80 ? `${text.slice(0, 80)}…` : text });
}

function registerShortcuts() {
  try { globalShortcut.register('CommandOrControl+Alt+V', sendClipboard); } catch { /* ignore */ }
  try {
    globalShortcut.register('CommandOrControl+Alt+B', () => (widget.isVisible() ? widget.hide() : widget.showInactive()));
  } catch { /* ignore */ }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('state:get', () => snapshot());
  ipcMain.handle('link:send', (_e, url) => {
    if (!isWebUrl(url)) return false;
    peer.sendMessage(url, 'link');
    showToast({ id: `link-${Date.now()}`, kind: 'info', ttl: 3000, title: 'Link sent', body: url.length > 80 ? `${url.slice(0, 80)}…` : url });
    return true;
  });
  ipcMain.handle('msg:send', (_e, text) => { peer.sendMessage(text); return true; });
  ipcMain.handle('files:send', (_e, paths) => {
    if (!Array.isArray(paths) || !paths.length) return false;
    return peer.sendPaths(paths.filter((p) => typeof p === 'string'));
  });
  ipcMain.handle('files:pick', async (_e, kind) => {
    suppressBlur = true;
    const r = await dialog.showOpenDialog(composer, {
      properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
    });
    suppressBlur = false;
    composer.focus();
    if (r.canceled || !r.filePaths.length) return false;
    return peer.sendPaths(r.filePaths);
  });
  ipcMain.handle('pair:host', () => peer.startPairHost());
  ipcMain.handle('pair:stop', () => peer.stopPairHost());
  ipcMain.handle('pair:connect', async (_e, { host, code, port }) => {
    try { await peer.pairWith(host, code, port); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('peer:manual-ip', (_e, ip) => { try { peer.connectManual(String(ip).trim()); return true; } catch { return false; } });
  ipcMain.handle('peer:unpair', () => { peer.unpair(); return true; });
  ipcMain.handle('history:clear', () => { peer.clearHistory(); return true; });
  ipcMain.handle('composer:toggle', () => toggleComposer());
  ipcMain.handle('composer:hide', () => composer.hide());
  let dragOrigin = null;
  ipcMain.on('widget:dragstart', () => { const b = widget.getBounds(); dragOrigin = { x: b.x, y: b.y }; });
  ipcMain.on('widget:dragmove', (_e, d) => {
    if (!dragOrigin) return;
    const p = clampToDisplay(dragOrigin.x + d.dx, dragOrigin.y + d.dy);
    widget.setBounds({ ...p, width: WIDGET, height: WIDGET });
    if (composer.isVisible()) composer.setBounds(panelBounds(COMPOSER.w, COMPOSER.h));
    positionToast();
  });
  ipcMain.on('widget:dragend', () => {
    if (!dragOrigin) return;
    dragOrigin = null;
    const b = widget.getBounds();
    store.set('pos', { x: b.x, y: b.y });
    applyCorner();
  });
  ipcMain.handle('widget:menu', () => buildMenu().popup({ window: widget }));
  ipcMain.handle('downloads:open', () => openDownloads());
  ipcMain.handle('toast:height', (_e, h) => { toastHeight = Math.max(0, Math.min(600, Math.round(h))); positionToast(); });
  ipcMain.handle('toast:action', (_e, a) => {
    if (!a) return;
    if (a.type === 'open' && typeof a.path === 'string') shell.showItemInFolder(a.path);
    if (a.type === 'copy' && typeof a.text === 'string') clipboard.writeText(a.text);
    if (a.type === 'url' && isWebUrl(a.url)) shell.openExternal(a.url);
  });
}

// ---------- wiring ----------

function wirePeer() {
  peer.on('state', pushState);
  peer.on('history', pushState);
  peer.on('paired', (name) => {
    showToast({ id: 'paired', kind: 'info', title: `Paired with ${name}`, body: 'You are connected. Drag files onto the wormhole.' });
    pushState();
  });
  peer.on('message', (m, from) => {
    widget.webContents.send('ping');
    if (m.kind === 'link' && isWebUrl(m.text) && store.get('openLinks')) {
      shell.openExternal(m.text);
      return showToast({ id: `msg-${m.id}`, kind: 'msg', ttl: 5000, title: `Opened link from ${from}`, body: m.text, copy: m.text });
    }
    if (composer.isVisible() && composer.isFocused()) return;
    showToast({
      id: `msg-${m.id}`, kind: 'msg', ttl: 5000,
      title: m.kind === 'clip' ? `Clipboard from ${from}` : from,
      body: m.text, copy: m.text,
    });
  });
  peer.on('progress', (p) => {
    widget.webContents.send('progress', p);
    const id = `xfer-${p.id}-${p.dir}`;
    if (p.finished) return showToast({ id, remove: true });
    const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0;
    showToast({
      id, kind: 'progress', title: `${p.dir === 'out' ? 'Sending' : 'Receiving'} ${p.label}`,
      body: `${fmtBytes(p.done)} of ${fmtBytes(p.total)}`, pct,
    });
  });
  peer.on('sent', ({ label, files }) => showToast({ id: `sent-${Date.now()}`, kind: 'info', ttl: 5000, title: 'Sent', body: `${label} (${files} file${files === 1 ? '' : 's'})` }));
  peer.on('received', ({ label, files, first, from }) => showToast({
    id: `recv-${Date.now()}`, kind: 'file', ttl: 14000,
    title: `Received from ${from}`, body: `${label} (${files} file${files === 1 ? '' : 's'})`, openPath: first,
  }));
  peer.on('notice', (n) => showToast({ id: `n-${Date.now()}`, kind: 'info', ttl: 6000, title: n.level === 'error' ? 'Error' : 'Heads up', body: n.text }));

  peer.offerHandler = async ({ label, files, total, from }) => {
    suppressBlur = true;
    const r = await dialog.showMessageBox({
      type: 'question', buttons: ['Accept', 'Decline'], defaultId: 0, cancelId: 1, title: 'Incoming files',
      message: `${from || 'Other PC'} wants to send ${label}`,
      detail: `${files} file${files === 1 ? '' : 's'}, ${fmtBytes(total)}`,
    });
    suppressBlur = false;
    return r.response === 0;
  };
}

app.on('second-instance', () => { if (composer) showComposer(); });
app.on('window-all-closed', () => { /* stay alive in the tray */ });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (peer) peer.stop(); });

app.whenReady().then(async () => {
  if (IS_MAC && app.dock) app.dock.hide();

  const userData = app.getPath('userData');
  store = new JsonStore(path.join(userData, 'config.json'), DEFAULTS);
  if (!store.get('downloadDir')) store.set('downloadDir', path.join(app.getPath('downloads'), 'Wormhole'));
  history = new JsonStore(path.join(userData, 'history.json'), { messages: [] });

  const name = os.hostname().replace(/\.local$/i, '');
  peer = new PeerService({ identity: loadOrCreate(userData), store, history, deviceName: name });

  registerIpc();
  createWidget();
  createComposer();
  createToast();
  createTray();
  wirePeer();
  registerShortcuts();
  screen.on('display-metrics-changed', applyCorner);
  screen.on('display-added', applyCorner);
  screen.on('display-removed', applyCorner);

  await peer.start();
  pushState();
  if (!store.get('peer')) setTimeout(showComposer, 800); // first run: go straight to pairing
});
