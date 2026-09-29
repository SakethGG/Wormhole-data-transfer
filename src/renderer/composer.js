'use strict';
const $ = (id) => document.getElementById(id);
const api = window.bh;
let state = null;
let selectedNearby = null;

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderStatus(s) {
  const dot = $('dot');
  dot.className = s.status;
  $('statusText').textContent = {
    unpaired: 'Not paired',
    offline: `${s.peerName || 'Other PC'} · offline`,
    connecting: `${s.peerName || 'Other PC'} · connecting…`,
    online: `${s.peerName || 'Other PC'} · connected`,
  }[s.status];
  $('peerLine').textContent = `This PC: ${s.ownName}`;
  const paired = s.status !== 'unpaired';
  $('pairView').hidden = paired;
  $('chatView').hidden = !paired;
  $('btnFiles').disabled = $('btnFolder').disabled = s.status !== 'online';
  document.querySelector('.tools').hidden = !paired;
  $('btnUnpair').hidden = !paired;
  $('offlineBar').hidden = s.status === 'online' || !paired;
  $('offlineText').textContent = s.status === 'connecting'
    ? 'Connecting…'
    : 'Other computer is offline. Messages will be delivered when it is back.';
}

function renderLog(list) {
  const log = $('log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.textContent = '';
  for (const m of list) {
    const div = document.createElement('div');
    div.className = `msg ${m.dir}${m.kind === 'clip' ? ' clip' : ''}`;
    div.title = 'Click to copy';
    div.append(document.createTextNode(m.text));
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${fmtTime(m.ts)}${m.dir === 'out' ? (m.delivered ? ' ✓' : ' …') : ''}`;
    div.append(meta);
    div.addEventListener('click', () => api.toastAction({ type: 'copy', text: m.text }));
    log.append(div);
  }
  $('empty').hidden = list.length > 0;
  if (atBottom || list.length) log.scrollTop = log.scrollHeight;
}

function renderPair(s) {
  const code = s.pairCode;
  $('btnShowCode').hidden = !!code;
  $('codeBlock').hidden = !code;
  $('code').textContent = code || '------';

  const box = $('nearby');
  box.textContent = '';
  if (!s.discovered.length) {
    box.textContent = 'No computer is showing a code yet. On the other one, choose "Show code".';
    selectedNearby = null;
    return;
  }
  for (const d of s.discovered) {
    const b = document.createElement('button');
    b.className = `peer-btn${selectedNearby && selectedNearby.key === d.key ? ' sel' : ''}`;
    b.textContent = `${d.name} (${d.host[0] || '?'})`;
    b.addEventListener('click', () => { selectedNearby = d; $('pairHost').value = ''; renderPair(state); $('pairCode').focus(); });
    box.append(b);
  }
}

function apply(s) {
  state = s;
  renderStatus(s);
  renderLog(s.history);
  if (s.status === 'unpaired') renderPair(s);
}

api.on('state', apply);
api.getState().then(apply);
api.on('composer:shown', () => { $('input').focus(); const l = $('log'); l.scrollTop = l.scrollHeight; });

// ---- chat ----
const input = $('input');
function autosize() { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 96)}px`; }
input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composeForm').requestSubmit(); }
});
$('composeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  api.sendMessage(text);
  input.value = '';
  autosize();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.hideComposer(); });

$('btnFiles').addEventListener('click', () => api.pickFiles('files'));
$('btnFolder').addEventListener('click', () => api.pickFiles('folder'));
$('btnOpen').addEventListener('click', () => api.openDownloads());
$('btnClear').addEventListener('click', () => api.clearHistory());
let unpairArmed = false;
$('btnUnpair').addEventListener('click', () => {
  if (!unpairArmed) {
    unpairArmed = true;
    $('btnUnpair').textContent = 'Click again to unpair';
    setTimeout(() => { unpairArmed = false; $('btnUnpair').textContent = 'Unpair'; }, 3000);
    return;
  }
  unpairArmed = false;
  $('btnUnpair').textContent = 'Unpair';
  api.unpair();
});
$('btnManualIp').addEventListener('click', () => { const v = $('manualIp').value.trim(); if (v) api.manualIp(v); });

// ---- pairing ----
$('btnShowCode').addEventListener('click', () => api.pairHost());
$('btnCancelCode').addEventListener('click', () => api.pairStop());
$('pairHost').addEventListener('input', () => { if ($('pairHost').value) { selectedNearby = null; renderPair(state); } });
$('btnPair').addEventListener('click', async () => {
  const err = $('pairError');
  err.textContent = '';
  const code = $('pairCode').value.trim();
  const host = selectedNearby ? selectedNearby.host[0] : $('pairHost').value.trim();
  const port = selectedNearby ? selectedNearby.port : undefined;
  if (!host) { err.textContent = 'Pick a computer above or enter its IP address.'; return; }
  if (!/^\d{6}$/.test(code)) { err.textContent = 'Enter the 6-digit code.'; return; }
  $('btnPair').disabled = true;
  const r = await api.pairConnect({ host, code, port });
  $('btnPair').disabled = false;
  if (!r.ok) err.textContent = r.error;
  else $('pairCode').value = '';
});
$('pairCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnPair').click(); });
