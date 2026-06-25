// Preload: bridges the renderer (sandboxed) to the main process via IPC.
// Must be CommonJS — Electron preload scripts run in a CJS context.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  list: () => ipcRenderer.invoke('hub:list'),
  enable: (id) => ipcRenderer.invoke('hub:enable', id),
  disable: (id) => ipcRenderer.invoke('hub:disable', id),
  onPhaseChanged: (cb) => {
    ipcRenderer.on('hub:phase-changed', (_event, data) => cb(data));
  },
});
