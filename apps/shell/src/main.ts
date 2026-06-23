/**
 * Electron main entry. Owns the OS-level window and the privileged host process
 * (input injection + accessibility APIs a browser sandbox forbids).
 *
 * Scaffold: creates the hub and a window. Renderer/IPC wiring is left as TODO.
 */

import { app, BrowserWindow } from 'electron';
import { createHub } from './bootstrap.js';

async function main(): Promise<void> {
  await app.whenReady();
  const hub = await createHub();

  const window = new BrowserWindow({
    width: 420,
    height: 640,
    title: 'AccessAbility Hub',
    webPreferences: {
      // Least privilege: no nodeIntegration in the renderer; talk via preload+IPC.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // TODO: load renderer (toggle UI / status / mode-switch UI) and bridge IPC to
  // hub.kernel (enable/disable) and hub.coordinator (switchTo).
  void window;
  void hub;

  app.on('window-all-closed', () => {
    void hub.kernel.shutdown().finally(() => app.quit());
  });
}

void main();
