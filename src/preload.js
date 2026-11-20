const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (s) => ipcRenderer.send('state:save', s),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  homeDir: () => ipcRenderer.invoke('home-dir'),
  createPty: (opts) => ipcRenderer.invoke('pty:create', opts),
  write: (id, d) => ipcRenderer.send('pty:write', id, d),
  resize: (id, c, r) => ipcRenderer.send('pty:resize', id, c, r),
  kill: (id) => ipcRenderer.send('pty:kill', id),
  notify: (o) => ipcRenderer.send('notify', o),
  onData: (cb) => ipcRenderer.on('pty:data', (_e, id, d) => cb(id, d)),
  onExit: (cb) => ipcRenderer.on('pty:exit', (_e, id, code) => cb(id, code)),
  onNotifyClick: (cb) => ipcRenderer.on('notify:click', (_e, wsId) => cb(wsId)),
});
