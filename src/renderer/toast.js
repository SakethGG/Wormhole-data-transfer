'use strict';
const stack = document.getElementById('stack');
const items = new Map(); // id -> {el, timer}
const MAX = 4;

function report() {
  // let layout settle, then tell the main process how tall the window must be
  requestAnimationFrame(() => window.bh.toastHeight(items.size ? stack.getBoundingClientRect().height + 4 : 0));
}

function remove(id) {
  const it = items.get(id);
  if (!it) return;
  clearTimeout(it.timer);
  it.el.remove();
  items.delete(id);
  report();
}

function arm(id, ttl) {
  const it = items.get(id);
  clearTimeout(it.timer);
  if (ttl) it.timer = setTimeout(() => remove(id), ttl);
}

function build(t) {
  const el = document.createElement('div');
  el.className = `toast ${t.kind || 'info'}`;
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = t.title || '';
  const body = document.createElement('div');
  body.className = 'body';
  body.textContent = t.body || '';
  el.append(title, body);

  if (t.kind === 'progress') {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.append(document.createElement('i'));
    el.append(bar);
  }
  if (t.openPath) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const b = document.createElement('button');
    b.textContent = 'Show in folder';
    b.addEventListener('click', (e) => { e.stopPropagation(); window.bh.toastAction({ type: 'open', path: t.openPath }); });
    actions.append(b);
    el.append(actions);
  }
  if (t.copy) {
    el.title = 'Click to copy';
    el.addEventListener('click', () => {
      window.bh.toastAction({ type: 'copy', text: t.copy });
      title.textContent = `${t.title} · copied`;
    });
  }
  if (t.kind !== 'msg') { // message bubbles always vanish after their 5 seconds
    el.addEventListener('mouseenter', () => { const it = items.get(t.id); if (it) clearTimeout(it.timer); });
    el.addEventListener('mouseleave', () => arm(t.id, t.kind === 'progress' ? 0 : 3000));
  }
  return el;
}

window.bh.on('toast:add', (t) => {
  if (t.remove) return remove(t.id);
  const existing = items.get(t.id);
  if (existing && t.kind === 'progress') {
    // update in place so a running transfer does not spawn a new card per tick
    existing.el.querySelector('.body').textContent = t.body || '';
    existing.el.querySelector('.title').textContent = t.title || '';
    existing.el.querySelector('.bar > i').style.width = `${t.pct || 0}%`;
    return;
  }
  if (existing) remove(t.id);
  const el = build(t);
  items.set(t.id, { el, timer: null });
  stack.append(el);
  if (t.kind === 'progress') el.querySelector('.bar > i').style.width = `${t.pct || 0}%`;
  while (items.size > MAX) remove(items.keys().next().value);
  arm(t.id, t.kind === 'progress' ? 0 : t.ttl || 6000);
  report();
});
