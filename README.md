# Wormhole

A tiny one-to-one portal between two computers on the same network.
Drag files or folders onto the wormhole in the corner of your screen and they land on your other computer. Type a short message and it pops up there instantly.

Works Windows ↔ Windows, Mac ↔ Mac and Windows ↔ Mac.

## Set up (each computer, once)

Requires [Node.js](https://nodejs.org) 18 or newer.

```
git clone <this repo>
cd Wormhole
npm install
npm run setup
```

`npm run setup` puts a **Wormhole** icon on your Desktop
(a `.lnk` on Windows, a `Wormhole.app` on macOS). Double-click it to start.
You can also run `npm start` from the folder.

Optional flags: `npm run setup -- --autostart` (Windows, start at login) and
`npm run setup -- --firewall` (Windows, adds the firewall rule for you).
You can also tick **Start when I log in** in the tray menu on either system.

The first time it runs, the OS asks to allow network access. Say **Allow** (on Windows, tick *Private networks*).

## Pair the two computers (once)

1. Start Wormhole on both computers. A small panel opens on first run.
2. On computer A choose **Show code**. A 6-digit code appears.
3. On computer B pick computer A from the list (or type its IP address), enter the code and press **Connect**.

That is it. From now on they find each other automatically whenever both are running.
Pairing pins each computer's certificate to the other, so no third device can join.

## Using it

| You want to | Do this |
| --- | --- |
| Send files or folders | Drop them onto the wormhole (or use **Files** / **Folder** in the panel) |
| Send a short message | Click the wormhole, type, press Enter |
| Send your clipboard | `Ctrl+Alt+V` (Windows) / `Cmd+Option+V` (Mac) |
| Show or hide the portal | `Ctrl+Alt+B` / `Cmd+Option+B` |
| Open received files | Toast button, panel footer, or tray menu. Default folder is `Downloads/Wormhole` |
| Change corner, receive folder, auto-accept, startup | Right-click the wormhole (or use the tray / menu-bar icon) |

- Incoming messages pop up near the portal. Click one to copy its text.
- If the other computer is offline, messages are queued and delivered when it comes back.
- Files with a name that already exists get ` (1)`, ` (2)`… instead of overwriting.
- Turn off **Auto-accept incoming files** in the menu to be asked before each transfer.

## Cross-platform notes

- File and folder names are made safe for the receiving system. Sending from a Mac to Windows replaces characters Windows forbids (`: * ? " < > | \`) with `_`.
- On Mac to Mac, permissions (such as the executable bit) and modified times are preserved.
- Windows has a 260-character path limit by default. Very deeply nested folders may fail to save there.

## If the computers cannot find each other

- Both must be on the same network. Some office or guest Wi-Fi networks block device-to-device traffic (*client isolation*). Nothing on the LAN can work there.
- Discovery uses mDNS. If it is blocked, open the panel and type the other computer's IP address (in the yellow *offline* bar, or in the pairing screen). The address is remembered.
- The default port is `47653` (TCP). Allow it through the firewall if you use one.

## How it works

- Both computers run the same app. Each has a self-signed certificate; its SHA-256 fingerprint is the device identity.
- Connections are TLS with mutual certificate checking. Pairing exchanges the fingerprints and proves both sides know the 6-digit code with an HMAC over both fingerprints. That defeats a man-in-the-middle, and the code locks after 5 wrong tries.
- Messages are small JSON frames. Files are streamed in chunks, so large files never sit in memory, and folders keep their structure.
- Only one computer connects at a time, so the connection is strictly 1-to-1.

```
src/main/       app lifecycle, windows, tray, IPC
src/net/        framing, identity, discovery, pairing, transfers
src/renderer/   portal, panel and toast UIs
scripts/        icon generation and desktop launcher setup
test/           headless end-to-end test (npm test)
```

Your identity, pairing and chat history live in the app's user-data folder
(`%APPDATA%\wormhole` on Windows, `~/Library/Application Support/wormhole` on macOS).
Delete it to reset everything.

## Limits of v1

- Interrupted transfers restart from the beginning (no resume yet).
- Files are sent over the local network only; there is no internet relay.
- The launcher runs from this folder, so keep the repository where it is (or re-run `npm run setup` after moving it).
- `npm run icons` regenerates the icons from `assets/icon.svg`.
