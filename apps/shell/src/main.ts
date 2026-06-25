/**
 * Electron main entry. Owns the OS-level window and the privileged host process.
 * Wires IPC between the renderer toggle UI and the kernel.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHub } from './bootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  await app.whenReady();
  const hub = await createHub();

  const win = new BrowserWindow({
    width: 420,
    height: 560,
    title: 'AccessAbility Hub',
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: false so CJS preload can use require('electron') reliably
      sandbox: false,
      preload: path.join(__dirname, '..', 'renderer', 'preload.cjs'),
    },
  });

  // Open DevTools so console errors are visible during development
  win.webContents.openDevTools({ mode: 'detach' });

  // Guard against duplicate registration on hot-restart
  ipcMain.removeHandler('hub:list');
  ipcMain.removeHandler('hub:enable');
  ipcMain.removeHandler('hub:disable');

  // IPC: list all installed services with their current phase
  ipcMain.handle('hub:list', () => {
    const services = hub.kernel.registry.list().map(({ service, phase }) => ({
      id: service.meta.id,
      name: service.meta.name,
      phase,
    }));
    console.log('[main] hub:list →', services);
    return services;
  });

  // IPC: enable a service and push the phase update directly to the renderer.
  // The lifecycle manager does not emit service/phase-changed on the bus, so
  // the shell bridges the state change here.
  ipcMain.handle('hub:enable', async (_e, id: string) => {
    console.log('[main] hub:enable', id);
    const result = await hub.kernel.enable(id);
    if (result.enabled && !win.isDestroyed()) {
      win.webContents.send('hub:phase-changed', { id, phase: 'enabled' });
    }
    return result;
  });

  ipcMain.handle('hub:disable', async (_e, id: string) => {
    console.log('[main] hub:disable', id);
    await hub.kernel.disable(id);
    if (!win.isDestroyed()) {
      win.webContents.send('hub:phase-changed', { id, phase: 'loaded' });
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  app.on('window-all-closed', () => {
    void hub.kernel.shutdown().finally(() => app.quit());
  });
}

void main();
