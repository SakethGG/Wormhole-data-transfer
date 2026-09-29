'use strict';
// Renders the pixel art assets/hole.png into icon.png (1024), icon.ico (multi-size) and tray.png.
// Run with:  npm run icons   (needs Electron, so it works on Windows and macOS)
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildIco(images) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, dir, ...images.map((i) => i.png)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, transparent: true, frame: false });
  const art = 'data:image/png;base64,' + fs.readFileSync(path.join(ASSETS, 'hole.png')).toString('base64');
  const html = `<html><body style="margin:0;background:transparent"><img src="${art}" width="1024" height="1024" style="image-rendering:pixelated;display:block"></body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const shot = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });

  fs.writeFileSync(path.join(ASSETS, 'icon.png'), shot.toPNG());
  const images = SIZES.map((size) => ({ size, png: shot.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buildIco(images));
  fs.writeFileSync(path.join(ASSETS, 'tray.png'), shot.resize({ width: 64, height: 64, quality: 'best' }).toPNG());
  console.log('icons written to', ASSETS);
  app.quit();
});
