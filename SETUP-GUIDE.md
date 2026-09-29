# Wormhole: Setup Guide (Windows PC + Mac)

Follow Part 1 on your Windows PC, Part 2 to move the code to your Mac, Part 3 on the Mac, then Part 4 to pair them.
Allow about 15 minutes the first time.

---

## Before you start

- Both computers must be on the **same Wi-Fi / network**.
- Both need **Node.js 18 or newer**. Check with `node -v` in a terminal. If it is missing, install the LTS version from https://nodejs.org.
- Do **not** copy the `node_modules` folder between the two computers. Each one must run its own `npm install`, because Electron is a different program on Windows and macOS.

---

## Part 1: Windows PC

1. Open PowerShell in the project folder:
   ```powershell
   cd D:\Projects\Wormhole
   ```
2. Install dependencies (already done here, but safe to repeat):
   ```powershell
   npm install
   ```
3. Create the desktop icon (already done here, but safe to repeat):
   ```powershell
   npm run setup
   ```
   You will now have a **Wormhole** icon on your Desktop.
   - Optional, start at Windows login: `npm run setup -- --autostart`
   - Optional, open the firewall for you: `npm run setup -- --firewall` (accept the admin prompt)
4. (Optional) Run the self-test to confirm the network code works on this machine:
   ```powershell
   npm test
   ```
   It should end with `ALL PASSED`.
5. Double-click the **Wormhole** icon.
   - Windows Firewall asks about network access. Tick **Private networks** and click **Allow access**. If you miss this, the Mac cannot connect. See Troubleshooting.
   - A small wormhole appears in the bottom-right corner, and a panel opens with the pairing screen. Leave it open.

---

## Part 2: Get the code onto the Mac

This folder is not a git repository yet. Pick **one** option.

### Option A: GitHub (best, and what "clone the repo" means)

On the Windows PC, in `D:\Projects\Wormhole`:
```powershell
git init
git add .
git commit -m "Wormhole"
```
Then create an empty **private** repository on GitHub (no README) and run:
```powershell
git branch -M main
git remote add origin https://github.com/<your-username>/wormhole.git
git push -u origin main
```
`.gitignore` already excludes `node_modules`, so only the source is uploaded.

On the Mac, in Terminal:
```bash
cd ~/Documents            # or wherever you keep projects
git clone https://github.com/<your-username>/wormhole.git
cd wormhole
```
Later, after any change on either machine, use `git pull` on the other.

### Option B: No GitHub (USB stick, AirDrop, cloud drive, or network share)

1. On the Windows PC, copy the `Wormhole` folder somewhere temporary.
2. **Delete `node_modules` from the copy.** If you skip this the Mac install breaks.
3. Zip it, move the zip to the Mac, and unzip it (for example to `~/Documents/Wormhole`).

---

## Part 3: Mac

Open **Terminal** (Cmd+Space, type "Terminal").

1. Check Node:
   ```bash
   node -v
   ```
   If you see `command not found` or a version below 18, install Node. Either download the LTS installer from https://nodejs.org, or if you use Homebrew run `brew install node`.
2. Go to the project folder:
   ```bash
   cd ~/Documents/wormhole      # adjust to where you put it
   ```
3. Install dependencies (about a minute; it downloads the Mac version of Electron):
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
6. Launch it by double-clicking **Wormhole** on the Desktop (or run `npm start` in the folder).
   - macOS asks **"Do you want the application to accept incoming network connections?"** Click **Allow**.
   - There is no Dock icon. Wormhole is a floating portal in the bottom-right corner plus an icon in the **menu bar** at the top of the screen.
   - If macOS says the app cannot be opened because it is from an unidentified developer, right-click the app, choose **Open**, then **Open** again. You only need to do this once.

---

## Part 4: Pair the two computers (once)

1. Make sure Wormhole is running on **both** computers.
2. On the **Windows PC**, in the panel, click **Show code**. A 6-digit code appears.
3. On the **Mac**, click the wormhole. The panel shows **"Enter a code from the other computer"**.
   - Your Windows PC should appear in the list under that heading. Click it. If it does not appear after about 10 seconds, type the PC's IP address instead (see "Finding an IP address" below).
   - Type the 6-digit code and click **Connect**.
4. Both sides show a "Paired" notification and the status dot on the wormhole turns **green**.

You never need to pair again. Whenever both are running, they reconnect on their own.

---

## Part 5: Everyday use

| You want to | Do this |
| --- | --- |
| Send files or folders | Drag them onto the wormhole. It swirls faster while you hover, then pulls them in |
| Send a short message | Click the wormhole, type, press **Enter** (**Shift+Enter** for a new line) |
| Send your clipboard | `Ctrl+Alt+V` on Windows, `Cmd+Option+V` on Mac |
| Show or hide the portal | `Ctrl+Alt+B` / `Cmd+Option+B` |
| See or copy a message | It pops up as a toast. Click it to copy the text |
| Open received files | Click **Show in folder** on the toast, or **Received files** in the panel. They are saved in `Downloads/Wormhole` |
| Change corner, receive folder, auto-accept, start at login | Right-click the wormhole, or use the tray icon (Windows) / menu-bar icon (Mac) |
| Stop a transfer | Tray or menu-bar icon, then **Cancel transfers** |
| Quit | Tray or menu-bar icon, then **Quit Wormhole** |

The dot on the wormhole: **green** = connected, **amber** = connecting, **grey** = other computer offline, **purple** = not paired yet.

---

## Troubleshooting

**The Mac does not show the Windows PC in the list**
- Confirm both are on the same Wi-Fi network (not one on a guest network or a VPN).
- Use the IP instead: type the Windows PC's IP address into the "IP address" box, then the code, then **Connect**.
- Check the Windows firewall rule (next item).

**Windows Firewall blocked it**
- Run `npm run setup -- --firewall` and accept the admin prompt, or open *Windows Security > Firewall & network protection > Allow an app through firewall*, find **Electron**, and tick **Private**.

**"Other computer is offline" keeps showing**
- Make sure Wormhole is running on the other machine (look for the wormhole or the tray / menu-bar icon).
- An IP address may have changed. In the yellow bar of the panel, type the other computer's current IP and click **Try**.
- Some office or guest Wi-Fi networks block computers from talking to each other (client isolation). If yours does, this cannot work on that network. Try a phone hotspot or your home network to confirm.

**Wrong code / pairing failed**
- Codes expire after 5 minutes and lock after 5 wrong tries. Click **Cancel**, then **Show code** again to get a fresh one.

**The Mac says the app is damaged or cannot be opened**
- Run `xattr -dr com.apple.quarantine ~/Applications/"Wormhole.app"` in Terminal, or right-click, **Open**.

**Nothing happens when I double-click the Mac icon**
- Run `npm start` from the project folder and read the error. Most often `npm install` was not run on the Mac.
- If you moved the project folder, run `npm run setup` again (the launcher points at the folder location).

**Start over from scratch**
- Quit Wormhole, then delete its data folder: `%APPDATA%\wormhole` on Windows, `~/Library/Application Support/wormhole` on Mac. Pair again.

### Finding an IP address
- **Windows:** run `ipconfig` and look for **IPv4 Address** under your Wi-Fi adapter (for example `192.168.1.23`).
- **Mac:** *System Settings > Wi-Fi > Details* shows the IP, or run `ipconfig getifaddr en0` in Terminal.

---

## Updating later

After changing the code on one machine (or pulling changes with `git pull`), run `npm install` if `package.json` changed, then quit and relaunch Wormhole. Re-run `npm run setup` only if you moved the project folder.

## Known limits

- Interrupted transfers restart from the beginning (no resume yet).
- Local network only, with no internet relay.
- I tested pairing, messaging and transfers on Windows. The Mac launcher and Windows↔Mac transfers have not been run on a real Mac yet, so tell me about anything that misbehaves and I will fix it.
