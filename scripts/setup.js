'use strict';
// One-command setup for Windows and macOS:  npm run setup
//   Windows: Desktop shortcut "Wormhole" with the wormhole icon
//   macOS:   "Wormhole.app" in ~/Applications and on the Desktop (alias-free copy)
// Optional flags:  --autostart   launch at login
//                  --firewall    (Windows) add an inbound firewall rule for the app (asks for admin)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const ASSETS = path.join(ROOT, 'assets');

function electronBinary() {
  try {
    const dist = path.join(ROOT, 'node_modules', 'electron', 'dist');
    if (process.platform === 'win32') return path.join(dist, 'electron.exe');
    if (process.platform === 'darwin') return path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  } catch { /* fall through */ }
  return null;
}

function ps(script) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'PowerShell failed').trim());
  return r.stdout.trim();
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function setupWindows() {
  const exe = electronBinary();
  if (!fs.existsSync(exe)) throw new Error('Electron is not installed yet. Run "npm install" first.');
  const desktop = ps("[Environment]::GetFolderPath('Desktop')");
  const make = (folder) => {
    const lnk = path.join(folder, 'Wormhole.lnk');
    ps(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${q(lnk)});`
      + `$s.TargetPath=${q(exe)};$s.Arguments=${q(`"${ROOT}"`)};$s.WorkingDirectory=${q(ROOT)};`
      + `$s.IconLocation=${q(path.join(ASSETS, 'icon.ico'))};$s.Description='Wormhole';$s.Save()`);
    return lnk;
  };
  console.log('Created', make(desktop));
  if (args.has('--autostart')) {
    const startup = ps("[Environment]::GetFolderPath('Startup')");
    console.log('Created', make(startup));
  }
  if (args.has('--firewall')) {
    console.log('Adding firewall rule (accept the admin prompt)...');
    ps(`Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command',`
      + `${q(`netsh advfirewall firewall add rule name="Wormhole" dir=in action=allow program="${exe}" profile=private enable=yes`)}`);
  } else {
    console.log('Tip: on first launch Windows asks to allow network access. Tick "Private networks".');
  }
}

function makeIcns(outFile) {
  const src = path.join(ASSETS, 'icon.png');
  const set = path.join(os.tmpdir(), `wormhole-${process.pid}.iconset`);
  fs.mkdirSync(set, { recursive: true });
  const sizes = [16, 32, 64, 128, 256, 512];
  for (const s of sizes) {
    spawnSync('sips', ['-z', String(s), String(s), src, '--out', path.join(set, `icon_${s}x${s}.png`)]);
    spawnSync('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(set, `icon_${s}x${s}@2x.png`)]);
  }
  const r = spawnSync('iconutil', ['-c', 'icns', set, '-o', outFile]);
  fs.rmSync(set, { recursive: true, force: true });
  if (r.status !== 0) throw new Error('iconutil failed');
}

function buildMacApp(dest) {
  const bin = electronBinary();
  if (!fs.existsSync(bin)) throw new Error('Electron is not installed yet. Run "npm install" first.');
  fs.rmSync(dest, { recursive: true, force: true });
  const macos = path.join(dest, 'Contents', 'MacOS');
  const res = path.join(dest, 'Contents', 'Resources');
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(res, { recursive: true });
  makeIcns(path.join(res, 'icon.icns'));
  fs.writeFileSync(path.join(dest, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Wormhole</string>
<key>CFBundleDisplayName</key><string>Wormhole</string>
<key>CFBundleIdentifier</key><string>com.wormhole.launcher</string>
<key>CFBundleExecutable</key><string>launch</string>
<key>CFBundleIconFile</key><string>icon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>
`);
  const launcher = path.join(macos, 'launch');
  fs.writeFileSync(launcher, `#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexec "${bin}" "${ROOT}"\n`);
  fs.chmodSync(launcher, 0o755);
}

function setupMac() {
  const apps = path.join(os.homedir(), 'Applications');
  fs.mkdirSync(apps, { recursive: true });
  const app = path.join(apps, 'Wormhole.app');
  buildMacApp(app);
  console.log('Created', app);
  const desktop = path.join(os.homedir(), 'Desktop', 'Wormhole.app');
  try {
    fs.rmSync(desktop, { recursive: true, force: true });
    spawnSync('ln', ['-s', app, desktop]);
    console.log('Linked', desktop);
  } catch { /* desktop may be protected; the ~/Applications copy is enough */ }
  console.log('Tip: first launch, macOS asks to allow incoming connections. Click Allow.');
  console.log('     To start at login, right-click the tray icon and tick "Start when I log in".');
}

try {
  if (process.platform === 'win32') setupWindows();
  else if (process.platform === 'darwin') setupMac();
  else console.log('Setup only creates launchers on Windows and macOS. Run "npm start" instead.');
  console.log('\nDone. Double-click "Wormhole" on your desktop to start it.');
} catch (e) {
  console.error('Setup failed:', e.message);
  process.exit(1);
}
