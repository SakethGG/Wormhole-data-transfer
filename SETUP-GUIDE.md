# Wormhole: Setup Guide (Windows and Mac)

This guide takes you from nothing to two paired computers. You can use any mix: Windows + Mac, Mac + Mac, or Windows + Windows.
Allow about 15 minutes.

**Overview:** on each computer you (1) install Node.js and git, (2) get the code, (3) run `npm install` and `npm run setup`, (4) launch Wormhole. Then you pair the two computers once.

---

## Before you start

- Both computers must be on the **same Wi-Fi / network**.
- Each needs **Node.js 18 or newer**. Check with `node -v` in a terminal. If it is missing, install the LTS version from https://nodejs.org (or `brew install node` on a Mac with Homebrew).
- Each needs **git** to download the code (`git --version` to check). Windows: https://git-scm.com/download/win. Mac: running `git` in Terminal offers to install the developer tools.
  No git? Download the ZIP from the GitHub page (**Code > Download ZIP**) and unzip it instead.
- **Never copy `node_modules` between computers.** Electron is a different program on Windows and macOS. Each computer runs its own `npm install`.

---

## Windows

Open **PowerShell** (Start menu, type "PowerShell").

1. Download the code (pick a folder you will keep, since the desktop icon points at it):
   ```powershell
   cd $HOME\Documents
   git clone https://github.com/SakethGG/Wormhole-data-transfer.git wormhole
   cd wormhole
   ```
2. Install dependencies (about a minute; it downloads Electron):
   ```powershell
   npm install
   ```
3. Create the desktop icon:
   ```powershell
   npm run setup
   ```
   A **Wormhole** icon appears on your Desktop.
   - Optional, start at Windows login: `npm run setup -- --autostart`
   - Optional, open the firewall for you: `npm run setup -- --firewall` (accept the admin prompt)
4. (Optional) Check the network code works on this machine:
   ```powershell
   npm test
   ```
   It should end with `ALL PASSED`.
5. Double-click the **Wormhole** icon.
   - Windows Firewall asks about network access. Tick **Private networks** and click **Allow access**. If you miss this, the other computer cannot connect (see Troubleshooting).
   - A small wormhole appears in a corner of your screen, plus an icon in the system tray.

---

## Mac

Open **Terminal** (Cmd+Space, type "Terminal").

1. Download the code:
   ```bash
   cd ~/Documents
   git clone https://github.com/SakethGG/Wormhole-data-transfer.git wormhole
   cd wormhole
   ```
2. Check Node is 18 or newer:
   ```bash
   node -v
   ```
   If you see `command not found` or an older version, install Node from https://nodejs.org or run `brew install node`.
3. Install dependencies (about a minute):
   ```bash
   npm install
   ```
4. Create the app icon:
   ```bash
   npm run setup
   ```
   This builds `~/Applications/Wormhole.app` with the wormhole icon and links it on your Desktop.
5. (Optional) Run the self-test:
   ```bash
   npm test
   ```
6. Double-click **Wormhole** on the Desktop (or run `npm start` in the folder).
   - macOS asks **"Do you want the application to accept incoming network connections?"** Click **Allow**.
   - There is no Dock icon. Wormhole is a floating portal on screen plus an icon in the **menu bar**.
   - If macOS says the app is from an unidentified developer or cannot be opened, right-click the app, choose **Open**, then **Open** again. You only do this once. If it says the app is "damaged", run:
     ```bash
     xattr -dr com.apple.quarantine ~/Applications/Wormhole.app
     ```

---

## Pair the two computers (once)

1. Make sure Wormhole is running on **both** computers.
2. On computer A, click the wormhole, then **Show code**. A 6-digit code appears.
3. On computer B, click the wormhole. Computer A should appear in the list under **Enter a code**. Click it. If it does not appear within about 10 seconds, type computer A's IP address instead (see "Finding an IP address" below).
4. Type the 6-digit code and click **Connect**.
5. Both sides show a "Paired" notification and the status dot on the wormhole turns green.

You never need to pair again. Whenever both are running, they reconnect on their own.

---

## Everyday use

| You want to | Do this |
| --- | --- |
| Send files or folders | Drag them onto the wormhole. It pulls them in |
| Send a short message | Click the wormhole, type, press **Enter** (**Shift+Enter** for a new line) |
| Send your clipboard | `Ctrl+Alt+V` on Windows, `Cmd+Option+V` on Mac |
| Show or hide the portal | `Ctrl+Alt+B` / `Cmd+Option+B` |
| Move the wormhole | Drag it anywhere. Its position is remembered |
| Read a message | It pops up above the wormhole for 5 seconds and stays in the chat when you open the panel |
| Open received files | **Show in folder** on the popup, **Received files** in the panel, or the tray menu. They are saved in `Downloads/Wormhole` |
| Corner, receive folder, auto-accept, start at login | Right-click the wormhole, or use the tray (Windows) / menu-bar (Mac) icon |
| Stop a transfer | Tray or menu-bar icon, then **Cancel transfers** |
| Quit | Tray or menu-bar icon, then **Quit Wormhole** |

The dot on the wormhole: **green** = connected, **amber** = connecting, **grey** = other computer offline, **purple** = not paired yet.

---

## Troubleshooting

**The other computer does not show up in the list**
- Confirm both are on the same Wi-Fi (not one on a guest network, and no VPN on either).
- Type the other computer's IP address into the "IP address" box, then the code, then **Connect**.
- Check the Windows firewall (next item).

**Windows Firewall blocked it**
- Run `npm run setup -- --firewall` and accept the admin prompt, or open *Windows Security > Firewall & network protection > Allow an app through firewall*, find **Electron**, and tick **Private**.
- The app uses TCP port `47653`.

**"Other computer is offline" keeps showing**
- Make sure Wormhole is running on the other computer (look for the wormhole or the tray / menu-bar icon).
- The IP address may have changed. In the yellow bar of the panel, type the other computer's current IP and click **Try**.
- Some office and guest Wi-Fi networks stop computers talking to each other (client isolation). Try a phone hotspot or your home network to confirm.

**A "Heads up: LAN discovery problem" popup appears**
- This means automatic discovery failed on one network adapter (often because of a VPN or virtual adapter). Wormhole keeps running. Enter the other computer's IP address manually.

**Wrong code / pairing failed**
- Codes expire after 5 minutes and lock after 5 wrong tries. Click **Cancel**, then **Show code** again for a fresh one.

**Nothing happens when I double-click the icon**
- Run `npm start` from the project folder and read the error. Most often `npm install` was not run on that computer.
- If you moved the project folder, run `npm run setup` again. The icon points at the folder location.
- If `npm start` says `Cannot read properties of undefined (reading 'whenReady')`, your terminal has `ELECTRON_RUN_AS_NODE` set. Clear it and retry. PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`. Mac/Linux shell: `unset ELECTRON_RUN_AS_NODE`.

**Quit does not seem to work or the app will not start a second time**
- Only one copy can run at a time. Quit from the tray or menu-bar icon, wait a few seconds, then start it again.

**Start over from scratch**
- Quit Wormhole, then delete its data folder: `%APPDATA%\wormhole` on Windows, `~/Library/Application Support/wormhole` on Mac. Pair again.

### Finding an IP address
- **Windows:** run `ipconfig` and look for **IPv4 Address** under your Wi-Fi adapter (for example `192.168.1.23`).
- **Mac:** *System Settings > Wi-Fi > Details* shows it, or run `ipconfig getifaddr en0` in Terminal.

---

## Updating

```bash
git pull
npm install        # only needed if package.json changed
```
Then quit and relaunch Wormhole. Re-run `npm run setup` only if you moved the project folder or the icon changed.

## Known limits

- Interrupted transfers restart from the beginning (no resume yet).
- Local network only, with no internet relay.
- The app is not code-signed, so macOS asks you to approve it once.
