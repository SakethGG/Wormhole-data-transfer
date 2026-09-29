'use strict';
const hole = document.getElementById('hole');
const bar = document.getElementById('bar');
let depth = 0;

function setStatus(status) {
  for (const s of ['online', 'offline', 'connecting', 'unpaired']) hole.classList.toggle(s, s === status);
}

window.addEventListener('dragenter', () => { depth++; hole.classList.add('drag'); });
window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; hole.classList.remove('drag'); } });
window.addEventListener('drop', () => {
  depth = 0;
  hole.classList.remove('drag', 'suck');
  void hole.offsetWidth;
  hole.classList.add('suck');
  setTimeout(() => hole.classList.remove('suck'), 700);
});

// Drag the portal anywhere on screen; a press that barely moves still counts as a click.
let press = null;
let dragged = false;
hole.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  press = { x: e.screenX, y: e.screenY };
  dragged = false;
  hole.setPointerCapture(e.pointerId);
});
hole.addEventListener('pointermove', (e) => {
  if (!press) return;
  const dx = e.screenX - press.x;
  const dy = e.screenY - press.y;
  if (!dragged) {
    if (Math.hypot(dx, dy) < 5) return;
    dragged = true;
    hole.classList.add('moving');
    window.bh.dragStart();
  }
  window.bh.dragMove({ dx, dy });
});
function endPress(e) {
  if (!press) return;
  press = null;
  if (hole.hasPointerCapture(e.pointerId)) hole.releasePointerCapture(e.pointerId);
  if (dragged) { hole.classList.remove('moving'); window.bh.dragEnd(); }
}
hole.addEventListener('pointerup', endPress);
hole.addEventListener('pointercancel', endPress);
hole.addEventListener('click', () => { if (dragged) { dragged = false; return; } window.bh.toggleComposer(); });
window.addEventListener('contextmenu', (e) => { e.preventDefault(); window.bh.widgetMenu(); });

window.bh.on('state', (s) => setStatus(s.status));
window.bh.getState().then((s) => setStatus(s.status));

window.bh.on('ping', () => {
  hole.classList.remove('ping');
  void hole.offsetWidth;
  hole.classList.add('ping');
});

let hideTimer;
window.bh.on('progress', (p) => {
  clearTimeout(hideTimer);
  const pct = p.total ? Math.min(100, (p.done / p.total) * 100) : 0;
  hole.classList.add('busy');
  bar.style.strokeDashoffset = String(100 - pct);
  if (p.finished) hideTimer = setTimeout(() => hole.classList.remove('busy'), 700);
});
