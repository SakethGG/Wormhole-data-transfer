# How Wormhole works

A guide for the person maintaining this project. It was written from a reading of the code and the fixes made while building it. Items marked "untested" have not been run on real hardware.

---

## 1. The big picture

Wormhole is an **Electron app**. There is one codebase, and each computer runs its own copy with no server in the middle.

```
        Computer A                                   Computer B
 ┌──────────────────────────┐                 ┌──────────────────────────┐
 │ Electron main process    │                 │ Electron main process    │
 │  ├ PeerService (net)     │◄══ TLS/TCP ═══► │  ├ PeerService (net)     │
 │  ├ windows, tray, IPC    │   port 47653    │  ├ windows, tray, IPC    │
 │  └ JSON stores (disk)    │                 │  └ JSON stores (disk)    │
 │ Renderers: widget,       │                 │ Renderers: widget,       │
 │  composer (panel), toast │                 │  composer, toast         │
 └──────────────────────────┘                 └──────────────────────────┘
          ▲  mDNS/Bonjour discovery on the LAN  ▲
```

Each side is both a **listener** (TLS server) and a **dialler** (TLS client). Either side can connect first. The code decides which connection survives if both connect at once (section 4).

**Folder layout**

| Path | Job |
| --- | --- |
| `src/main/main.js` | App lifecycle, the three windows, tray, global shortcuts, IPC handlers, wiring events to UI |
| `src/main/config.js` | Tiny JSON key-value store for settings |
| `src/net/framing.js` | Binary wire format |
| `src/net/identity.js` | Creates and loads this computer's certificate |
| `src/net/peer.js` | Everything networked: discovery, pairing, sessions, messages, file transfer |
| `src/renderer/*` | The widget, panel and popup pages, plus `preload.js` |
| `scripts/setup.js`, `make-icons.js` | Desktop launchers and icon generation |
| `test/selftest.js` | Headless end-to-end test (`npm test`) |

---

## 2. Identity and security model

**Identity is a certificate.** On first run, `identity.js` uses the `selfsigned` package to generate a 2048-bit RSA, SHA-256 certificate valid for 10 years. It is saved to `identity.json` in the app data folder with mode `0o600`. The certificate's **SHA-256 fingerprint** is the device's identity. There are no accounts.

**Trust is pinning, not certificate authorities.** Both the server and the client set `rejectUnauthorized: false` and `requestCert: true`. That looks alarming but is deliberate: the certificates are self-signed, so normal CA validation would always fail. Instead, the code reads the peer's certificate fingerprint itself and compares it with the fingerprint stored at pairing time (`peer.js`, `_connect` and `_onHandshakeFrame`). This is the same idea as SSH's `known_hosts`.

**Pairing (first time only).** One computer shows a random 6-digit code from `crypto.randomInt`. The other computer types it in.

- The code is **never sent over the network.** The client sends `HMAC-SHA256(code, "C|clientFp|serverFp")`, and the server replies with `HMAC(code, "S|serverFp|clientFp")`.
- The hash includes **both certificate fingerprints.** A man-in-the-middle presents a different certificate, so the hashes cannot match. This ties the low-entropy code to the real certificates.
- Comparison uses `crypto.timingSafeEqual`.
- The code lives for 5 minutes, and after 5 wrong tries the host stops accepting pairing (`PAIR_MAX_FAILURES`).
- On success each side stores `{fp, name, ip, port}` as its single `peer`.

**Sessions.** Later connections use `intent: 'session'`. The listener accepts only if the connecting certificate's fingerprint equals the stored peer's. Anything else gets `reject: not-paired`.

**Honest limits:** the 6-digit code is only about 20 bits, so the protection depends on the 5-try lockout and the 5-minute window. Data at rest (received files, chat history) is not encrypted, and on Windows `0o600` on the key file does not restrict access.

---

## 3. Discovery (finding the other computer)

`bonjour-service` (mDNS / DNS-SD) advertises a `_wormhole._tcp` service with TXT records `{id, name, pair}`. `id` is the first 16 characters of the fingerprint, and `pair` says whether a pairing code is currently showing.

- **Browsing** finds other Wormhole instances. While unpaired, the panel lists those with `pair=1`. While paired, the code looks up the peer's `id` to get its current IPs.
- **Fallbacks:** the last known IP is stored in `peer.ip`, and there is a manual IP box. Some networks block mDNS or isolate clients, so the manual IP is essential.
- **Republishing:** `_publish()` re-advertises whenever the pairing state changes so the `pair` flag stays current.
- **A crash that was fixed:** `bonjour-service` throws on a multicast send error by default. `EHOSTUNREACH 224.0.0.251:5353` (caused by a VPN or virtual adapter) killed the main process. The code now passes an error callback and listens on the underlying socket, and shows one "Heads up" toast instead.

---

## 4. Connection management

- **Reconnect loop:** `_tick()` runs every 3 seconds. If paired and not connected, it picks a candidate address (`discovered` IPs plus the stored IP, rotating with `this.rotate`) and calls `_connect`.
- **Heartbeat:** a `ping` every 5 seconds. If nothing has been heard for 25 seconds the socket is destroyed, which triggers reconnect. This catches half-dead connections after sleep or Wi-Fi changes.
- **Simultaneous connect tie-break** (`_ready`): both computers may dial each other at once. Each connection is labelled by the fingerprint of whoever **initiated** it. The one with the lexicographically smaller initiator fingerprint wins, so both sides pick the same survivor without talking.
- **Handshake timeout:** an unauthenticated inbound socket is dropped after 10 seconds.
- **Listening port:** `47653`. If taken, it falls back to port 0 (any free port) and advertises the real one.

---

## 5. Wire protocol

Every message is a frame: `[type: 1 byte][length: 4 bytes big-endian][payload]`.

- **Type 1 (JSON):** control messages such as `hello`, `msg`, `offer`, `accept`, `items`, `fstart`, `done`, `cancel`, `ping`.
- **Type 2 (data):** file bytes, prefixed with a 4-byte transfer id.
- The decoder buffers partial TCP reads, handles several frames arriving in one read, and rejects frames over 4 MB. Bad frames destroy the socket.

This matters because TCP is a byte stream with no message boundaries.

---

## 6. Messages, links and clipboard

- `sendMessage(text, kind)` where `kind` is `text`, `clip` or `link`. Every message gets a UUID and is stored in `history` (last 50) with `delivered: false`.
- The receiver replies `ack`, and the sender flips `delivered` (the tick in the panel).
- **Offline queue:** undelivered outgoing messages are re-sent by `_flushOutbox()` when the link becomes ready.
- **De-duplication:** `seenMsgIds` (500 entries) prevents a resent message being shown twice.
- **Links:** `kind: 'link'` messages are opened with `shell.openExternal` only if the URL parses as `http:` or `https:` (`isWebUrl`) and the "open links" setting is on. Everything else, such as `file:` or custom protocols, is refused.

---

## 7. File transfer

Sender flow (`_sendBatch`):

1. **Build a manifest** (`buildManifest`): walk the paths with `lstat`, skip symlinks, record relative path, size, mtime and (on Mac/Linux) mode. Top-level name collisions in one batch get ` (2)` suffixes.
2. **Offer:** send `{offer, id, label, files, total}` and wait up to 2 minutes for `accept` or `reject`. If auto-accept is off, the receiver shows a prompt.
3. **Send the item list** in batches of 500, then `items-end`.
4. **Stream each file:** `fstart`, then 256 KB chunks from `fs.createReadStream`, then `fend`. Memory use stays flat regardless of file size.
5. **`done`**, then wait up to 60 seconds for the receiver's `received` confirmation.

**Backpressure:** on the sender, `socket.write` returning `false` makes `sendData` await `'drain'`. On the receiver, if the file write stream is full it calls `socket.pause()` and resumes on the stream's `'drain'`. Without this, a fast sender would fill memory.

**Serialisation:** `sendQueue` is a promise chain, so batches go one at a time.

Receiver flow and safety checks:

- Each path segment goes through `sanitizeSegment`. On Windows it replaces `< > : " | ? * \` and control characters with `_`, strips trailing dots and spaces, and prefixes reserved names (`CON`, `NUL`, `COM1`...).
- `..` and empty segments are rejected outright.
- After joining, the resolved destination must still start with the receive folder plus a path separator, which blocks path traversal.
- `uniqueName` avoids overwriting existing files by adding `(1)`, `(2)`...
- After each file: mode restored (non-Windows) and mtime restored. Folder mtimes are restored after all contents are written.
- **Cancel / connection loss:** partial files are deleted, and both sides clean up.
- **Progress:** throttled to about 12 updates per second (80 ms) to avoid flooding the UI.

**Known gaps:** no resume, so an interrupted transfer starts over. Only one peer is supported.

---

## 8. The app shell (Electron)

- **Three frameless, transparent, always-on-top windows:** the widget (80 px), the composer panel (350x540) and the toast popup. `baseWindow()` sets `skipTaskbar`, `hasShadow: false`, and always-on-top at level `screen-saver` on Windows and `floating` on Mac. On Mac, `setVisibleOnAllWorkspaces` shows it over full-screen apps too.
- **Renderer security:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and a strict Content-Security-Policy on every page. Renderers cannot touch Node. They only see the small API exposed by `preload.js` through `contextBridge`, and an allow-list (`EVENTS`) limits what the main process can push.
- **IPC pattern:** `ipcRenderer.invoke` / `ipcMain.handle` for requests, and `send`/`on` for fire-and-forget drag events.
- **Single instance lock:** a second launch exits. That is why you must fully quit before relaunching.
- **Tray/menu bar and shortcuts:** `Tray` with a rebuilt context menu each state change. `globalShortcut` registers Ctrl/Cmd+Alt+B (show/hide) and Ctrl/Cmd+Alt+V (send clipboard).
- **Window placement:** `anchor()` decides whether the widget is in the right or bottom half of its screen, so panels and popups grow away from the screen edge. `panelBounds()` computes their position.
- **Blur handling:** the panel hides when it loses focus. `lastBlurHide` (250 ms) stops the click that closed it from reopening it.
- **Settings and data:** `JsonStore` files in `app.getPath('userData')`: settings, peer, chat history and `identity.json`.

---

## 9. UI techniques

- **Draggable widget:** pointer events with `setPointerCapture`. A move under 5 px still counts as a click. The renderer sends deltas over IPC, and the main process moves the window with `setBounds`, clamped to the nearest display (`getDisplayNearestPoint`). The position is saved as `pos`. Choosing a corner from the menu clears it.
- **Small size:** the artwork is designed at 110 px and shown at 80 px using `webContents.setZoomFactor`, so all sizes scale together.
- **Pixel-art icon:** the reference image was sampled on a 5.7 px grid, taking the most common colour in a 3x3 neighbourhood per cell, with the background made transparent. The result is `assets/hole.png` (64x47 cells, padded to square). It is rendered with `image-rendering: pixelated` for the icons (`make-icons.js`).
- **Icons:** `make-icons.js` renders the PNG inside a hidden Electron window and screenshots it with `capturePage`. It hand-builds a multi-size `.ico` (PNG-in-ICO) and a tray PNG. On Mac, `setup.js` uses `sips` and `iconutil` to build a `.icns`.
- **Desktop launchers:** Windows creates a `.lnk` through PowerShell's `WScript.Shell` COM object. Mac generates a tiny `.app` bundle (`Info.plist`, a `launch` shell script that `exec`s Electron, `LSUIElement` so there is no Dock icon), placed in `~/Applications` and symlinked to the Desktop.
- **Comic look:** CSS variables in `theme.css`, flat panels with dark outlines, muted colours.
- **Drop animation:** on `drop`, the artwork spins and shrinks (`suck-spin`) while small "paper chips" fly into the centre using CSS custom properties for each chip's start point.
- **Genie popup:** the main process computes a `transform-origin` pointing at the icon and sends it with each toast. `genie-in` / `genie-out` keyframes scale and skew from that point. Dismissal plays the exit animation for 380 ms before removing the node. This is an approximation of Apple's effect, not the real thing.
- **Toast sizing:** the popup window is resized to fit its content, so the page reports its height to the main process.

---

## 10. Drag-and-drop input (three cases)

All in `preload.js`, because only preload can turn a dropped `File` into a path (`webUtils.getPathForFile`).

1. **Real files** (Explorer/Finder): `dt.files` gives paths, which go to `files:send`.
2. **Links:** if `text/uri-list`, `text/x-moz-url` or plain text is an `http(s)` URL, it goes to `link:send`. Browsers do not pass a tab's URL when you drag the tab itself, so the padlock, URL text or a link works but the tab does not.
3. **Editors (VS Code):** the sidebar drags text, not files. The code gathers candidates from `codefiles`, `resourceurls`, `text/uri-list` and plain text, and `candidateToPath` in the main process converts `file://`, `vscode-file://` and quoted paths into real paths and keeps only those that exist. If none exist, the text is sent as a normal message. This works for local windows only, not remote/SSH windows.

**Key gotcha:** drag data is readable only *during* the event, so everything is read synchronously before any asynchronous call.

---

## 11. Bugs hit while building, and why

| Symptom | Cause | Fix |
| --- | --- | --- |
| Crash on `EHOSTUNREACH 224.0.0.251` | mDNS library rethrows send errors | Error callback plus socket listener, toast instead |
| "Object has been destroyed" on Quit | Windows destroyed first, then a late peer event touched them | `quitting` flag set in `before-quit`; `pushState`/`rebuildTray` bail out |
| Popup worked on Mac, not Windows | Hidden window never fires `requestAnimationFrame` on Windows, so the height report never ran | `setTimeout` instead, and `backgroundThrottling` off |
| `Cannot read properties of undefined (reading 'whenReady')` | `ELECTRON_RUN_AS_NODE=1` in the terminal (VS Code sets it) makes Electron run as plain Node | Unset it (the Mac launcher already does) |
| Patch scripts failing to match | Some files use CRLF line endings | Normalise line endings, edit, then restore them |
| VS Code drops sent a path | VS Code drags text, not files | Path-candidate resolution (section 10) |

---

## 12. Maintainer notes

- **Untested:** Windows-to-Mac transfers, the Mac launcher, the genie and suck animations on real hardware, the link-open feature, and VS Code drags. Only the automated `npm test` and screenshots were run.
- **`npm test`** (`test/selftest.js`) runs pairing, messaging, transfers and reconnect headlessly. Run it after any change to `peer.js`.
- **Keep `node_modules` per machine.** Electron's binary is OS-specific.
- **Changing the port or protocol** breaks compatibility between old and new versions. There is no version negotiation in the handshake, so adding one is a good next step.
- **Auto-accept and auto-open-links are on by default.** That is convenient, but it means a paired computer can push files and open pages on the other. Consider defaulting to prompts.
- **Icons:** edit `assets/hole.png`, run `npm run icons` (with `ELECTRON_RUN_AS_NODE` unset), then `npm run setup` to refresh the shortcuts.
- **Reasonable next steps:** resume for interrupted transfers, a version field in the handshake, encrypting history at rest, a proper installer (`electron-builder`) with code signing, and multi-peer support.
