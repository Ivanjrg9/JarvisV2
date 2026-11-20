const { app, BrowserWindow, ipcMain, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
const ptys = new Map();

const stateFile = () => path.join(app.getPath('userData'), 'state.json');

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 900, minWidth: 800, minHeight: 500,
    backgroundColor: '#0a0c14',
    title: 'JarvisV2',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0c14', symbolColor: '#aab0e0', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.setAppUserModelId('JarvisV2');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { for (const p of ptys.values()) { try { p.kill(); } catch {} } ptys.clear(); });

// ---------- estado ----------
ipcMain.handle('state:load', () => {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return null; }
});
ipcMain.on('state:save', (_e, data) => {
  try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(data, null, 2)); } catch {}
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('home-dir', () => app.getPath('home'));

// ---------- terminales ----------
ipcMain.handle('pty:create', (_e, { id, cwd, kind, resume, cols, rows }) => {
  if (ptys.has(id)) return true;
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  for (const k of Object.keys(env)) if (/^CLAUDECODE$|^CLAUDE_CODE_/i.test(k)) delete env[k];

  let args = ['-NoLogo'];
  if (kind === 'claude') {
    const cmd = resume
      ? 'claude --continue; if ($LASTEXITCODE -ne 0) { claude }'
      : 'claude';
    args = ['-NoLogo', '-NoExit', '-Command', cmd];
  }
  let dir = cwd;
  try { if (!fs.existsSync(dir)) dir = app.getPath('home'); } catch { dir = app.getPath('home'); }

  try {
    const p = pty.spawn('powershell.exe', args, {
      name: 'xterm-256color', cols: cols || 100, rows: rows || 30, cwd: dir, env, useConpty: true,
    });
    ptys.set(id, p);
    p.onData((d) => { if (win && !win.isDestroyed()) win.webContents.send('pty:data', id, d); });
    p.onExit(({ exitCode }) => {
      ptys.delete(id);
      if (win && !win.isDestroyed()) win.webContents.send('pty:exit', id, exitCode);
    });
    return true;
  } catch (err) {
    return String(err && err.message || err);
  }
});
ipcMain.on('pty:write', (_e, id, data) => { const p = ptys.get(id); if (p) p.write(data); });
ipcMain.on('pty:resize', (_e, id, cols, rows) => {
  const p = ptys.get(id);
  if (p && cols > 0 && rows > 0) { try { p.resize(cols, rows); } catch {} }
});
ipcMain.on('pty:kill', (_e, id) => { const p = ptys.get(id); if (p) { try { p.kill(); } catch {} ptys.delete(id); } });

// ---------- notificaciones ----------
ipcMain.on('notify', (_e, { title, body, wsId }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); win.webContents.send('notify:click', wsId); }
  });
  n.show();
});

