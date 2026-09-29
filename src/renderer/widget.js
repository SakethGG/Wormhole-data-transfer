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

hole.addEventListener('click', () => window.bh.toggleComposer());
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
