# Wormhole

A tiny one-to-one portal between two computers on the same network.
Drag files or folders onto the wormhole on your screen and they land on your other computer. Type a short message and it pops up there.

Works Windows ↔ Windows, Mac ↔ Mac and Windows ↔ Mac. No account, no cloud, no internet needed.

**New here? Follow [SETUP-GUIDE.md](SETUP-GUIDE.md).** It walks through everything step by step.

## Quick start (each computer, once)

You need [Node.js](https://nodejs.org) 18 or newer (LTS is fine) and `git`.

```
git clone https://github.com/SakethGG/Wormhole-data-transfer.git wormhole
cd wormhole
npm install
npm run setup
```

`npm run setup` puts a **Wormhole** icon on your Desktop (a shortcut on Windows, `Wormhole.app` on macOS). Double-click it to start. You can also run `npm start` from the folder.

Do this on **both** computers. Never copy `node_modules` between them: Electron is a different program on Windows and macOS, so each computer needs its own `npm install`.

The first time it runs, the OS asks to allow network access. Choose **Allow** (on Windows, tick *Private networks*).

Setup options:

| Command | What it does |
| --- | --- |
| `npm run setup -- --autostart` | Windows: also start Wormhole when you log in |
| `npm run setup -- --firewall` | Windows: add the firewall rule for you (accept the admin prompt) |
| `npm start` | Run without the desktop icon |
| `npm test` | Headless self-test of the network code (should end with `ALL PASSED`) |

On macOS, tick **Start when I log in** in the menu-bar menu to autostart.

## Pair the two computers (once)

1. Start Wormhole on both computers.
2. On computer A click the wormhole, then **Show code**. A 6-digit code appears.
3. On computer B click the wormhole, pick computer A from the list (or type its IP address), enter the code and press **Connect**.

From then on they reconnect on their own whenever both are running.
Pairing pins each computer's certificate to the other, so no third device can join.

## Using it

| You want to | Do this |
| --- | --- |
| Send files or folders | Drop them onto the wormhole (or use **Files** / **Folder** in the panel) |
| Send a short message | Click the wormhole, type, press Enter (Shift+Enter for a new line) |
| Send your clipboard | `Ctrl+Alt+V` (Windows) / `Cmd+Option+V` (Mac) |
| Move the wormhole | Drag it anywhere on screen. It remembers the spot |
| Show or hide the portal | `Ctrl+Alt+B` / `Cmd+Option+B` |
| Open received files | Toast button, panel footer, or tray menu. Default folder is `Downloads/Wormhole` |
| Snap to a corner, change receive folder, auto-accept, startup | Right-click the wormhole (or use the tray / menu-bar icon) |
| Quit | Tray / menu-bar icon, then **Quit Wormhole** |

- An incoming message pops up above the wormhole for 5 seconds. Every message is also kept in the panel's chat history. Click a popup to copy its text.
- If the other computer is offline, messages are queued and delivered when it comes back.
- A file whose name already exists gets ` (1)`, ` (2)`… instead of overwriting.
- Turn off **Auto-accept incoming files** in the menu to be asked before each transfer.

## Cross-platform notes

- File and folder names are made safe for the receiving system. Sending from a Mac to Windows replaces characters Windows forbids (`: * ? " < > | \`) with `_`.
- On Mac to Mac, permissions (such as the executable bit) and modified times are preserved.
- Windows has a 260-character path limit by default, so very deeply nested folders may fail to save there.

## If the computers cannot find each other

- Both must be on the same network. Some office or guest Wi-Fi networks block device-to-device traffic (*client isolation*). Nothing on the LAN can work there.
- Discovery uses mDNS. If it is blocked, or a VPN or virtual adapter confuses it, type the other computer's IP address in the panel (the yellow *offline* bar, or the pairing screen). The address is remembered.
- The default port is `47653` (TCP). Allow it through the firewall if you use one.

More fixes are in the Troubleshooting section of [SETUP-GUIDE.md](SETUP-GUIDE.md).

## What it can do

- Send files and whole folders (structure kept) between two paired computers, any size, streamed so memory stays low.
- Send short text messages and your clipboard. Messages queue if the other computer is offline and arrive when it is back.
- Find the other computer automatically on the local network, or connect by IP address.
- Work across Windows and Mac in any combination.
- Run quietly as a small movable icon plus a tray / menu-bar icon.

## Security

Checked by reading the code. It has not had an independent security audit.

**Protected**

- **Encrypted in transit.** All files, messages and clipboard text travel over TLS, so someone sniffing the Wi-Fi sees only scrambled data.
- **Only your paired computer is accepted.** After pairing, each side pins the other's certificate fingerprint. Any other device on the network can reach the port but is rejected as "not paired".
- **Pairing cannot be hijacked.** The 6-digit code is never sent. Both sides prove they know it with a hash that includes both certificates, so a man-in-the-middle fails. A code lasts 5 minutes and locks after 5 wrong tries.
- **Unsafe file paths are blocked.** Incoming names are sanitised and anything that would escape the receive folder is rejected.

**Not protected**

- **Data at rest is not encrypted.** Received files sit in `Downloads/Wormhole` and chat history is plain text in the app data folder. Use BitLocker or FileVault if that matters.
- **The app announces itself on the LAN.** While running, it advertises its device name and whether a pairing code is showing. This reveals the name, not your data.
- **Auto-accept is on by default.** Your paired computer can drop files into your receive folder without asking. Turn it off in the right-click menu for a prompt each time.
- **A paired computer is trusted.** Files are not scanned, so do not open ones you did not expect.
- **The device key is stored in the app data folder.** Anyone who copies it can impersonate that computer. It is saved owner-only on Mac, but that restriction is not applied on Windows.

**Good habits:** pair on a network you trust, close **Show code** once paired, and use **Unpair** (or delete the data folder) if a computer is lost.

## Limitations

- **Exactly two computers.** It is one-to-one. There is no group sharing or more than one paired peer.
- **Same local network only.** There is no internet relay, so it does not work across different networks. Guest Wi-Fi with client isolation blocks it.
- **Both computers must be running** to transfer. There is no cloud storage or "send later" for files. Only messages are queued.
- **No resume.** An interrupted transfer starts again from the beginning.
- **Windows path limit.** Very deeply nested folders may fail to save because of the 260-character limit.
- **Not code-signed.** macOS asks you to approve it once. Windows Firewall needs Private-network access allowed.
- **Windows to Mac renames.** Characters Windows forbids are replaced with `_`. Mac to Mac keeps permissions and modified times.
- **Needs Node.js.** It runs from the source folder, so install Node 18+ and run `npm install` on each computer. There is no installer yet.

## How it works

- Both computers run the same app. Each has a self-signed certificate; its SHA-256 fingerprint is the device identity.
- Connections are TLS with mutual certificate checking. Pairing exchanges the fingerprints and proves both sides know the 6-digit code with an HMAC over both fingerprints. That defeats a man-in-the-middle, and the code locks after 5 wrong tries.
- Messages are small JSON frames. Files are streamed in chunks, so large files never sit in memory, and folders keep their structure.
- Only one computer connects at a time, so the connection is strictly 1-to-1.

```
src/main/       app lifecycle, windows, tray, IPC
src/net/        framing, identity, discovery, pairing, transfers
src/renderer/   portal, panel and toast UIs
assets/         icons (hole.png is the source artwork)
scripts/        icon generation and desktop launcher setup
test/           headless end-to-end test (npm test)
```

Your identity, pairing and chat history live in the app's user-data folder
(`%APPDATA%\wormhole` on Windows, `~/Library/Application Support/wormhole` on macOS).
Delete it (with Wormhole closed) to reset everything.

## Notes

- The launcher points at this folder, so keep it where it is, or re-run `npm run setup` after moving it.
- `npm run icons` regenerates the app icons from `assets/hole.png`.

## License

MIT
