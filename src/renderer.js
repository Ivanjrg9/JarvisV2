/* global Terminal, FitAddon, WebglAddon, api */
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const baseName = (p) => (p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

const COLORS = ['#7c5cff', '#00d4ff', '#ff5c8a', '#ffb020', '#2de2a6', '#ff7a45', '#c26bff', '#4d8dff'];

const svg = (p) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICON = {
  splitR: svg('<rect x="2" y="3" width="12" height="10" rx="2.5"/><path d="M8 3v10"/>'),
  splitD: svg('<rect x="2" y="3" width="12" height="10" rx="2.5"/><path d="M2 8h12"/>'),
  shell: svg('<path d="M3.5 5.5l3 2.5-3 2.5M8.5 11h4"/>'),
  zoom: svg('<path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
};

let state = { workspaces: [], active: null, settings: { fontSize: 14, collapsed: false } };
const runtime = new Map();   // paneId -> runtime del panel
const wsRoots = new Map();   // wsId -> contenedor
const wsFlags = new Map();   // wsId -> { working, attention }
let focusedPane = null;
let saveTimer = null;

const THEME = {
  background: '#0b0d18', foreground: '#eceeff', cursor: '#00d4ff', cursorAccent: '#0b0d18', selectionBackground: 'rgba(124,92,255,.45)',
  black: '#1d2240', red: '#ff5c7a', green: '#2de2a6', yellow: '#ffd166', blue: '#5c9dff', magenta: '#c26bff', cyan: '#00d4ff', white: '#eceeff',
  brightBlack: '#5b6296', brightRed: '#ff8099', brightGreen: '#6df0c2', brightYellow: '#ffe08a', brightBlue: '#8bb8ff', brightMagenta: '#d99bff', brightCyan: '#66e6ff', brightWhite: '#ffffff',
};

// ---------------- estado / árbol ----------------
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => api.saveState(state), 200); }
const flags = (id) => { if (!wsFlags.has(id)) wsFlags.set(id, { working: false, attention: false }); return wsFlags.get(id); };
const wsById = (id) => state.workspaces.find((w) => w.id === id);
const activeWs = () => wsById(state.active);
const newPane = (kind) => ({ type: 'pane', id: uid(), kind, started: false });
const split = (dir, ratio, a, b) => ({ type: 'split', dir, ratio, a, b });

const TEMPLATES = {
  single: { label: 'Un panel', desc: 'Solo Claude', build: () => newPane('claude') },
  duo: { label: 'Claude + Terminal', desc: 'Lado a lado', build: () => split('row', 0.62, newPane('claude'), newPane('shell')) },
  trio: { label: 'Tres paneles', desc: '2 Claude + terminal', build: () => split('row', 0.55, newPane('claude'), split('col', 0.5, newPane('claude'), newPane('shell'))) },
  quad: { label: 'Cuadrícula 2×2', desc: '3 Claude + terminal', build: () => split('col', 0.5, split('row', 0.5, newPane('claude'), newPane('claude')), split('row', 0.5, newPane('claude'), newPane('shell'))) },
};
const THUMBS = {
  single: '<i></i>', duo: '<i></i><i class="t"></i>', trio: '<i></i><i></i><i class="t"></i>', quad: '<i></i><i></i><i></i><i class="t"></i>',
};

function panesOf(node, out = []) {
  if (!node) return out;
  if (node.type === 'pane') out.push(node); else { panesOf(node.a, out); panesOf(node.b, out); }
  return out;
}
function mapPane(node, id, fn) {
  if (node.type === 'pane') return node.id === id ? fn(node) : node;
  return { ...node, a: mapPane(node.a, id, fn), b: mapPane(node.b, id, fn) };
}
function removePane(node, id) {
  if (node.type === 'pane') return node.id === id ? null : node;
  const a = removePane(node.a, id), b = removePane(node.b, id);
  if (!a) return b; if (!b) return a;
  return { ...node, a, b };
}
function wsOfPane(paneId) { return state.workspaces.find((w) => panesOf(w.layout).some((p) => p.id === paneId)); }

// ---------------- avisos y diálogos ----------------
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 2400);
}
function askConfirm(title, text, okLabel = 'Aceptar') {
  return new Promise((resolve) => {
    $('#d-title').textContent = title; $('#d-text').textContent = text; $('#d-ok').textContent = okLabel;
    const box = $('#dialog'); box.classList.remove('hidden');
    const done = (v) => { box.classList.add('hidden'); $('#d-ok').onclick = $('#d-cancel').onclick = null; box.onkeydown = null; resolve(v); };
    $('#d-ok').onclick = () => done(true); $('#d-cancel').onclick = () => done(false);
    box.onkeydown = (e) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
    box.tabIndex = -1; box.focus();
  });
}

// ---------------- paneles ----------------
function getRt(pane, ws) {
  if (runtime.has(pane.id)) return runtime.get(pane.id);
  const el = document.createElement('div');
  el.className = 'pane enter';
  el.dataset.pane = pane.id;
  el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
  el.innerHTML = `
    <div class="pane-head">
      <span class="status"></span><span class="kind"></span><span class="title"></span><span class="spacer"></span>
      <div class="tools">
        <button class="tbtn" data-a="splitR" title="Dividir a la derecha con otro Claude (Ctrl+Shift+D)">${ICON.splitR}</button>
        <button class="tbtn" data-a="splitD" title="Dividir hacia abajo con otro Claude (Ctrl+Shift+E)">${ICON.splitD}</button>
        <button class="tbtn" data-a="shellR" title="Añadir una terminal a la derecha (Ctrl+Shift+T)">${ICON.shell}</button>
        <button class="tbtn" data-a="zoom" title="Maximizar o restaurar el panel (Ctrl+Shift+Enter)">${ICON.zoom}</button>
        <button class="tbtn" data-a="close" title="Cerrar panel (Ctrl+Shift+W)">${ICON.close}</button>
      </div>
    </div>
    <div class="term"></div>`;
  const termEl = $('.term', el);
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
    fontSize: state.settings.fontSize, fontWeightBold: '700', lineHeight: 1.18,
    cursorStyle: 'bar', cursorWidth: 2, cursorBlink: true, scrollback: 10000,
    smoothScrollDuration: 90, theme: THEME, allowProposedApi: true,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); return false;
    }
    return true;
  });

  const rt = { id: pane.id, kind: pane.kind, term, fit, el, termEl, opened: false, createdAt: 0, idleTimer: null, busyTimer: null, raf: 0 };
  term.onData((d) => api.write(pane.id, d));
  term.onTitleChange((t) => { $('.title', el).textContent = t; });
  el.addEventListener('mousedown', () => setFocus(pane.id), true);
  el.addEventListener('click', (e) => { const b = e.target.closest('button[data-a]'); if (b) paneAction(pane.id, b.dataset.a); });
  $('.pane-head', el).addEventListener('dblclick', (e) => { if (!e.target.closest('button')) paneAction(pane.id, 'zoom'); });
  el.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); changeFont(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
  new ResizeObserver(() => { cancelAnimationFrame(rt.raf); rt.raf = requestAnimationFrame(() => fitPane(rt)); }).observe(termEl);
  paintHead(rt, pane, ws);
  runtime.set(pane.id, rt);
  return rt;
}

function paintHead(rt, pane, ws) {
  const k = $('.kind', rt.el);
  k.textContent = pane.kind === 'claude' ? 'Claude' : 'Terminal';
  k.className = 'kind' + (pane.kind === 'claude' ? '' : ' shell');
  const t = $('.title', rt.el);
  if (!t.textContent) t.textContent = baseName(ws.cwd);
}

function fitPane(rt) {
  if (!rt.opened || rt.termEl.offsetWidth === 0 || rt.termEl.offsetHeight === 0) return;
  try { rt.fit.fit(); api.resize(rt.id, rt.term.cols, rt.term.rows); } catch {}
}
function fitAll() { for (const rt of runtime.values()) fitPane(rt); }

function setFocus(paneId) {
  focusedPane = paneId;
  for (const [id, rt] of runtime) rt.el.classList.toggle('focused', id === paneId);
}
function currentPaneId() {
  const ws = activeWs(); if (!ws) return null;
  if (focusedPane && wsOfPane(focusedPane) === ws) return focusedPane;
  return panesOf(ws.layout)[0]?.id || null;
}

async function openPane(pane, ws) {
  const rt = getRt(pane, ws);
  if (rt.opened) return;
  rt.opened = true;
  rt.term.open(rt.termEl);
  try {
    const gl = new WebglAddon.WebglAddon();
    gl.onContextLoss(() => gl.dispose());
    rt.term.loadAddon(gl);
  } catch { /* se usa el render normal */ }
  rt.fit.fit();
  rt.createdAt = Date.now();
  const res = await api.createPty({ id: pane.id, cwd: ws.cwd, kind: pane.kind, resume: !!pane.started, cols: rt.term.cols, rows: rt.term.rows });
  if (res !== true) rt.term.write(`\r\n\x1b[31mNo se pudo iniciar el terminal: ${res}\x1b[0m\r\n`);
  pane.started = true; save();
}

async function paneAction(paneId, action) {
  const ws = wsOfPane(paneId); if (!ws) return;
  if (action === 'zoom') {
    const rt = runtime.get(paneId); if (!rt) return;
    rt.el.classList.toggle('zoom');
    setFocus(paneId); rt.term.focus();
    return;
  }
  if (action === 'close') {
    if (panesOf(ws.layout).length <= 1) { toast('Es el último panel. Para quitar el espacio, ciérralo desde la barra lateral.'); return; }
    ws.layout = removePane(ws.layout, paneId);
    api.kill(paneId);
    const rt = runtime.get(paneId);
    if (rt) { clearTimeout(rt.idleTimer); clearTimeout(rt.busyTimer); rt.term.dispose(); rt.el.remove(); runtime.delete(paneId); }
    if (focusedPane === paneId) focusedPane = null;
  } else {
    const dir = action === 'splitD' ? 'col' : 'row';
    const kind = action === 'shellR' ? 'shell' : 'claude';
    const fresh = newPane(kind);
    ws.layout = mapPane(ws.layout, paneId, (p) => ({ type: 'split', dir, ratio: 0.5, a: p, b: fresh }));
    focusedPane = fresh.id;
  }
  save();
  renderSidebar();
  await renderWorkspace(ws);
}

function moveFocus(dir) {
  const ws = activeWs(); if (!ws) return;
  const cur = runtime.get(currentPaneId()); if (!cur) return;
  const r0 = cur.el.getBoundingClientRect();
  const c0 = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
  let best = null, bestScore = Infinity;
  for (const p of panesOf(ws.layout)) {
    const rt = runtime.get(p.id); if (!rt || rt === cur) continue;
    const r = rt.el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - c0.x, dy = r.top + r.height / 2 - c0.y;
    const ok = dir === 'left' ? dx < -5 : dir === 'right' ? dx > 5 : dir === 'up' ? dy < -5 : dy > 5;
    if (!ok) continue;
    const score = (dir === 'left' || dir === 'right') ? Math.abs(dx) + 2 * Math.abs(dy) : Math.abs(dy) + 2 * Math.abs(dx);
    if (score < bestScore) { bestScore = score; best = rt; }
  }
  if (best) { setFocus(best.id); best.term.focus(); }
}

// ---------------- render de espacios ----------------
function buildNode(node, ws) {
  if (node.type === 'pane') return getRt(node, ws).el;
  const box = document.createElement('div');
  box.className = 'split ' + node.dir;
  const a = document.createElement('div'); a.className = 'cell'; a.style.flex = `${node.ratio} 1 0`;
  const b = document.createElement('div'); b.className = 'cell'; b.style.flex = `${1 - node.ratio} 1 0`;
  const r = document.createElement('div'); r.className = 'resizer';
  a.appendChild(buildNode(node.a, ws)); b.appendChild(buildNode(node.b, ws));
  box.append(a, r, b);
  r.addEventListener('mousedown', (ev) => {
    ev.preventDefault(); r.classList.add('drag');
    const rect = box.getBoundingClientRect();
    const move = (e) => {
      const ratio = node.dir === 'row' ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
      node.ratio = Math.min(0.9, Math.max(0.1, ratio));
      a.style.flex = `${node.ratio} 1 0`; b.style.flex = `${1 - node.ratio} 1 0`;
    };
    const up = () => { r.classList.remove('drag'); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); save(); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
  return box;
}

function rootFor(ws) {
  if (!wsRoots.has(ws.id)) {
    const d = document.createElement('div'); d.className = 'ws-root';
    $('#stage').appendChild(d); wsRoots.set(ws.id, d);
  }
  const root = wsRoots.get(ws.id);
  root.style.setProperty('--ws', ws.color);
  return root;
}

async function renderWorkspace(ws) {
  const root = rootFor(ws);
  root.replaceChildren(buildNode(ws.layout, ws));
  if (ws.id !== state.active) return;
  for (const p of panesOf(ws.layout)) await openPane(p, ws);
  requestAnimationFrame(() => {
    for (const p of panesOf(ws.layout)) { const rt = runtime.get(p.id); if (rt) { paintHead(rt, p, ws); fitPane(rt); } }
    const target = currentPaneId();
    if (target) { setFocus(target); runtime.get(target)?.term.focus(); }
  });
}

async function activate(id) {
  const ws = wsById(id); if (!ws) return;
  state.active = id;
  const f = flags(id); f.attention = false;
  document.documentElement.style.setProperty('--cur', ws.color);
  $('#empty').classList.add('hidden');
  const root = rootFor(ws);
  for (const [wid, r] of wsRoots) r.classList.toggle('active', wid === id);
  renderSidebar();
  await renderWorkspace(ws);
  root.classList.add('active');
  requestAnimationFrame(fitAll);
  save();
}

// ---------------- barra lateral ----------------
function renderSidebar() {
  const list = $('#ws-list'); list.replaceChildren();
  state.workspaces.forEach((ws, i) => {
    const f = flags(ws.id);
    const n = panesOf(ws.layout).length;
    const item = document.createElement('div');
    item.className = 'ws-item' + (ws.id === state.active ? ' active' : '');
    item.style.setProperty('--c', ws.color);
    item.style.animationDelay = `${i * 30}ms`;
    item.draggable = true;
    item.innerHTML = `
      <div class="avatar ${f.working ? 'working' : ''}">${(ws.name[0] || '?').toUpperCase()}${f.attention ? '<span class="badge"></span>' : ''}</div>
      <div class="info">
        <div class="name"></div>
        <div class="meta"><span class="path"></span>${f.working ? '<span class="chip working">Trabajando</span>' : f.attention ? '<span class="chip done">Listo</span>' : ''}</div>
      </div>
      <button class="x" title="Cerrar este espacio">${ICON.close}</button>`;
    $('.name', item).textContent = ws.name;
    $('.path', item).textContent = `${n} ${n === 1 ? 'panel' : 'paneles'} · ${baseName(ws.cwd)}`;
    item.title = `${ws.name}\n${ws.cwd}${i < 9 ? `\nAlt+${i + 1}` : ''}`;
    item.addEventListener('click', (e) => { if (!e.target.closest('.x') && !e.target.closest('input')) activate(ws.id); });
    $('.name', item).addEventListener('dblclick', (e) => { e.stopPropagation(); renameWs(ws, item); });
    $('.x', item).addEventListener('click', (e) => { e.stopPropagation(); deleteWs(ws); });
    // arrastrar para reordenar
    item.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', ws.id); item.classList.add('dragging'); });
    item.addEventListener('dragend', () => { item.classList.remove('dragging'); document.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      const r = item.getBoundingClientRect(); const before = e.clientY < r.top + r.height / 2;
      item.classList.toggle('drop-before', before); item.classList.toggle('drop-after', !before);
    });
    item.addEventListener('dragleave', () => item.classList.remove('drop-before', 'drop-after'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = e.dataTransfer.getData('text/plain'); if (!from || from === ws.id) return;
      const r = item.getBoundingClientRect(); const before = e.clientY < r.top + r.height / 2;
      const moved = state.workspaces.find((w) => w.id === from);
      state.workspaces = state.workspaces.filter((w) => w.id !== from);
      let idx = state.workspaces.findIndex((w) => w.id === ws.id); if (!before) idx++;
      state.workspaces.splice(idx, 0, moved);
      save(); renderSidebar();
    });
    list.appendChild(item);
  });
  $('#empty').classList.toggle('hidden', state.workspaces.length > 0);
}

function renameWs(ws, item) {
  const nameEl = $('.name', item);
  const input = document.createElement('input'); input.type = 'text'; input.value = ws.name;
  nameEl.replaceChildren(input); input.focus(); input.select();
  let finished = false;
  const done = (ok) => { if (finished) return; finished = true; if (ok && input.value.trim()) { ws.name = input.value.trim(); save(); } renderSidebar(); };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  input.addEventListener('blur', () => done(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

async function deleteWs(ws) {
  if (!(await askConfirm(`¿Cerrar "${ws.name}"?`, 'Se terminarán todas las sesiones de este espacio. Los archivos de tu proyecto no se tocan.', 'Cerrar espacio'))) return;
  for (const p of panesOf(ws.layout)) {
    api.kill(p.id);
    const rt = runtime.get(p.id);
    if (rt) { clearTimeout(rt.idleTimer); clearTimeout(rt.busyTimer); rt.term.dispose(); rt.el.remove(); runtime.delete(p.id); }
  }
  wsRoots.get(ws.id)?.remove(); wsRoots.delete(ws.id); wsFlags.delete(ws.id);
  state.workspaces = state.workspaces.filter((w) => w.id !== ws.id);
  if (state.active === ws.id) {
    state.active = state.workspaces[0]?.id || null;
    if (state.active) activate(state.active); else renderSidebar();
  } else renderSidebar();
  save();
}

function cycleColor() {
  const ws = activeWs(); if (!ws) return;
  ws.color = COLORS[(COLORS.indexOf(ws.color) + 1) % COLORS.length];
  rootFor(ws); document.documentElement.style.setProperty('--cur', ws.color);
  renderSidebar(); save();
}

function toggleSidebar(force) {
  const c = typeof force === 'boolean' ? force : !document.body.classList.contains('collapsed');
  document.body.classList.toggle('collapsed', c);
  state.settings.collapsed = c; save();
}

function changeFont(delta) {
  const s = delta === 0 ? 14 : Math.min(24, Math.max(10, state.settings.fontSize + delta));
  state.settings.fontSize = s;
  for (const rt of runtime.values()) rt.term.options.fontSize = s;
  requestAnimationFrame(fitAll); save();
  toast(`Tamaño de letra: ${s}`);
}

// ---------------- plantillas y modal ----------------
let selTemplate = 'single', selColor = COLORS[0];

function renderTemplates(container, onPick, selected) {
  container.replaceChildren();
  for (const [key, t] of Object.entries(TEMPLATES)) {
    const b = document.createElement('button');
    b.className = 'tpl' + (key === selected ? ' sel' : ''); b.type = 'button';
    b.innerHTML = `<div class="thumb ${key}">${THUMBS[key]}</div><div>${t.label}<small>${t.desc}</small></div>`;
    b.addEventListener('click', () => onPick(key));
    container.appendChild(b);
  }
}
function renderSwatches() {
  const box = $('#m-colors'); box.replaceChildren();
  for (const c of COLORS) {
    const s = document.createElement('div'); s.className = 'sw' + (c === selColor ? ' sel' : ''); s.style.setProperty('--c', c);
    s.addEventListener('click', () => { selColor = c; renderSwatches(); });
    box.appendChild(s);
  }
}
function paintModal() {
  renderTemplates($('#m-templates'), (k) => { selTemplate = k; paintModal(); }, selTemplate);
  renderSwatches();
}
async function openModal(template) {
  selTemplate = template || 'single';
  selColor = COLORS[state.workspaces.length % COLORS.length];
  $('#m-name').value = '';
  $('#m-cwd').value = await api.homeDir();
  paintModal();
  $('#modal').classList.remove('hidden');
  $('#m-name').focus();
}
const closeModal = () => $('#modal').classList.add('hidden');
async function createWs() {
  const cwd = $('#m-cwd').value.trim(); if (!cwd) { $('#m-cwd').focus(); return; }
  const name = $('#m-name').value.trim() || baseName(cwd);
  const ws = { id: uid(), name, cwd, color: selColor, layout: TEMPLATES[selTemplate].build() };
  state.workspaces.push(ws);
  closeModal();
  await activate(ws.id);
  toast(`Espacio "${name}" creado`);
}
$('#m-browse').addEventListener('click', async () => {
  const p = await api.pickFolder();
  if (p) { $('#m-cwd').value = p; if (!$('#m-name').value.trim()) $('#m-name').value = baseName(p); }
});
$('#m-cancel').addEventListener('click', closeModal);
$('#m-ok').addEventListener('click', createWs);
$('#modal').addEventListener('keydown', (e) => { if (e.key === 'Enter') createWs(); if (e.key === 'Escape') closeModal(); });
$('#modal').addEventListener('mousedown', (e) => { if (e.target === $('#modal')) closeModal(); });
$('#btn-new').addEventListener('click', () => openModal());
$('#btn-toggle').addEventListener('click', () => toggleSidebar());
$('#btn-palette').addEventListener('click', () => openPalette());

// ---------------- paleta de comandos ----------------
let palItems = [], palSel = 0;
function buildPaletteItems() {
  const items = [];
  state.workspaces.forEach((ws, i) => items.push({ sec: 'Espacios', label: ws.name, hint: i < 9 ? `Alt+${i + 1}` : ws.cwd, color: ws.color, run: () => activate(ws.id) }));
  const hasWs = !!activeWs();
  items.push({ sec: 'Acciones', label: 'Nuevo espacio de trabajo', hint: 'Ctrl+Shift+N', run: () => openModal() });
  if (hasWs) {
    items.push(
      { sec: 'Acciones', label: 'Dividir a la derecha (Claude)', hint: 'Ctrl+Shift+D', run: () => paneAction(currentPaneId(), 'splitR') },
      { sec: 'Acciones', label: 'Dividir hacia abajo (Claude)', hint: 'Ctrl+Shift+E', run: () => paneAction(currentPaneId(), 'splitD') },
      { sec: 'Acciones', label: 'Añadir terminal a la derecha', hint: 'Ctrl+Shift+T', run: () => paneAction(currentPaneId(), 'shellR') },
      { sec: 'Acciones', label: 'Maximizar o restaurar panel', hint: 'Ctrl+Shift+Enter', run: () => paneAction(currentPaneId(), 'zoom') },
      { sec: 'Acciones', label: 'Cerrar panel', hint: 'Ctrl+Shift+W', run: () => paneAction(currentPaneId(), 'close') },
      { sec: 'Acciones', label: 'Cambiar color del espacio', hint: '', run: cycleColor },
      { sec: 'Acciones', label: 'Renombrar espacio', hint: 'Doble clic', run: () => { const el = [...document.querySelectorAll('.ws-item')].find((x) => x.classList.contains('active')); if (el) renameWs(activeWs(), el); } },
    );
  }
  items.push(
    { sec: 'Vista', label: 'Mostrar u ocultar barra lateral', hint: 'Ctrl+B', run: () => toggleSidebar() },
    { sec: 'Vista', label: 'Aumentar letra', hint: 'Ctrl +', run: () => changeFont(1) },
    { sec: 'Vista', label: 'Reducir letra', hint: 'Ctrl -', run: () => changeFont(-1) },
    { sec: 'Vista', label: 'Restablecer tamaño de letra', hint: 'Ctrl 0', run: () => changeFont(0) },
  );
  return items;
}
function renderPalette() {
  const q = $('#p-input').value.trim().toLowerCase();
  palItems = buildPaletteItems().filter((i) => !q || i.label.toLowerCase().includes(q));
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  const list = $('#p-list'); list.replaceChildren();
  if (!palItems.length) { list.innerHTML = '<div class="p-empty">Nada coincide con tu búsqueda</div>'; return; }
  let sec = '';
  palItems.forEach((it, idx) => {
    if (it.sec !== sec) { sec = it.sec; const h = document.createElement('div'); h.className = 'p-sec'; h.textContent = sec; list.appendChild(h); }
    const row = document.createElement('div'); row.className = 'p-item' + (idx === palSel ? ' sel' : '');
    if (it.color) row.style.setProperty('--c', it.color);
    row.innerHTML = `${it.color ? '<span class="dotc"></span>' : ''}<span class="lbl"></span><span class="hint"></span>`;
    $('.lbl', row).textContent = it.label; $('.hint', row).textContent = it.hint || '';
    row.addEventListener('mousemove', () => { if (palSel !== idx) { palSel = idx; paintPalSel(); } });
    row.addEventListener('click', () => runPal(idx));
    list.appendChild(row);
  });
}
function paintPalSel() {
  [...document.querySelectorAll('#p-list .p-item')].forEach((r, i) => r.classList.toggle('sel', i === palSel));
  document.querySelectorAll('#p-list .p-item')[palSel]?.scrollIntoView({ block: 'nearest' });
}
function openPalette() { $('#p-input').value = ''; palSel = 0; renderPalette(); $('#palette').classList.remove('hidden'); $('#p-input').focus(); }
function closePalette() { $('#palette').classList.add('hidden'); const t = currentPaneId(); if (t) runtime.get(t)?.term.focus(); }
function runPal(idx) { const it = palItems[idx]; if (!it) return; $('#palette').classList.add('hidden'); setTimeout(() => it.run(), 30); }
$('#p-input').addEventListener('input', () => { palSel = 0; renderPalette(); });
$('#p-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = (palSel + 1) % Math.max(1, palItems.length); paintPalSel(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = (palSel - 1 + palItems.length) % Math.max(1, palItems.length); paintPalSel(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPal(palSel); }
  else if (e.key === 'Escape') closePalette();
});
$('#palette').addEventListener('mousedown', (e) => { if (e.target === $('#palette')) closePalette(); });

// ---------------- atajos ----------------
window.addEventListener('keydown', (e) => {
  const k = e.key;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  const modalOpen = !!document.querySelector('.overlay:not(.hidden)');
  if (e.ctrlKey && !e.shiftKey && !e.altKey && k.toLowerCase() === 'k') { stop(); modalOpen && !$('#palette').classList.contains('hidden') ? closePalette() : openPalette(); return; }
  if (modalOpen) return;
  if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(k)) { const ws = state.workspaces[Number(k) - 1]; if (ws) { stop(); activate(ws.id); } return; }
  if (e.altKey && !e.ctrlKey && k.startsWith('Arrow')) { stop(); moveFocus(k.slice(5).toLowerCase()); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && k.toLowerCase() === 'b') { stop(); toggleSidebar(); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (k === '=' || k === '+')) { stop(); changeFont(1); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (k === '-' || k === '_')) { stop(); changeFont(-1); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && k === '0') { stop(); changeFont(0); return; }
  if (e.ctrlKey && e.shiftKey && !e.altKey) {
    const pid = currentPaneId();
    const map = { N: () => openModal(), D: () => pid && paneAction(pid, 'splitR'), E: () => pid && paneAction(pid, 'splitD'), T: () => pid && paneAction(pid, 'shellR'), W: () => pid && paneAction(pid, 'close') };
    if (k === 'Enter') { stop(); pid && paneAction(pid, 'zoom'); return; }
    const fn = map[k.toUpperCase()]; if (fn) { stop(); fn(); }
  }
}, true);

// ---------------- actividad y avisos ----------------
api.onData((id, data) => {
  const rt = runtime.get(id); if (!rt) return;
  rt.term.write(data);
  rt.el.classList.add('busy');
  clearTimeout(rt.busyTimer); rt.busyTimer = setTimeout(() => rt.el.classList.remove('busy'), 1400);
  const ws = wsOfPane(id); if (!ws) return;
  if (Date.now() - rt.createdAt < 6000) return;
  if (ws.id === state.active && document.hasFocus()) return;
  const f = flags(ws.id);
  if (!f.working) { f.working = true; renderSidebar(); }
  clearTimeout(rt.idleTimer);
  rt.idleTimer = setTimeout(() => {
    f.working = false; f.attention = true; renderSidebar();
    api.notify({ title: ws.name, body: rt.kind === 'claude' ? 'Claude ha terminado o espera tu respuesta' : 'La terminal ha terminado', wsId: ws.id });
  }, 4000);
});
api.onExit((id, code) => {
  const rt = runtime.get(id);
  if (rt) rt.term.write(`\r\n\x1b[90m[proceso terminado, código ${code}]\x1b[0m\r\n`);
});
api.onNotifyClick((wsId) => activate(wsId));
window.addEventListener('focus', () => {
  const ws = activeWs(); if (!ws) return;
  const f = flags(ws.id); f.attention = false; f.working = false; renderSidebar();
  const t = currentPaneId(); if (t) runtime.get(t)?.term.focus();
});
window.addEventListener('resize', fitAll);

// ---------------- arranque ----------------
(async function init() {
  try {
    await Promise.all([
      document.fonts.load('400 14px "JetBrains Mono"'), document.fonts.load('700 14px "JetBrains Mono"'),
      document.fonts.load('400 14px Inter'), document.fonts.load('700 14px Inter'),
    ]);
  } catch {}
  const saved = await api.loadState();
  if (saved && Array.isArray(saved.workspaces)) {
    state = { ...state, ...saved, settings: { ...state.settings, ...(saved.settings || {}) } };
    state.workspaces.forEach((w, i) => { if (!w.color) w.color = COLORS[i % COLORS.length]; });
  }
  if (state.settings.collapsed) document.body.classList.add('collapsed');
  renderTemplates($('#empty-templates'), (k) => openModal(k), null);
  renderSidebar();
  const first = wsById(state.active) ? state.active : state.workspaces[0]?.id;
  if (first) await activate(first);
})();
