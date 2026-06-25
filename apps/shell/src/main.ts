/**
 * Electron main process — the composition root for the desktop hub.
 *
 * Boots the (headless, reusable) hub from {@link createHub}, opens a BrowserWindow
 * with a context-isolated preload, and wires a thin IPC bridge:
 *
 *   bus events  ->  recompute view-models  ->  webContents.send(...)  -> renderer
 *   renderer    ->  ipcMain.handle(enable/disable)  ->  kernel.enable/disable
 *
 * No business logic lives here: it only wires the existing hub/runtime to the UI via
 * the PURE view-model helpers. The hub itself (kernel, coordinator, overlay, remotes)
 * is unchanged and stays independently testable headless.
 *
 * NOTE: This file imports `electron` and therefore is NEVER imported by unit tests
 * (vitest runs under Node and cannot load Electron). All testable logic lives in
 * `./ui/*` instead.
 */

import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import type { EventTopic } from '@aah/contracts';
import { createHub, type Hub } from './bootstrap.js';
import { IPC } from './ui/ipc-contract.js';
import { overlayLayerToView, toServiceViews } from './ui/view-model.js';

/** Bus topics that change what the UI should show. */
const UI_TOPICS: EventTopic[] = [
  'service/phase-changed',
  'service/health',
  'overlay/attach',
  'overlay/update',
  'overlay/detach',
];

let hub: Hub | null = null;
let win: BrowserWindow | null = null;
let quitting = false;

/** Push the current service rows to the renderer. */
function pushServices(target: BrowserWindow): void {
  if (!hub) return;
  target.webContents.send(IPC.servicesPush, toServiceViews(hub.kernel.registry.list()));
}

/** Push the current overlay layers to the renderer. */
function pushOverlay(target: BrowserWindow): void {
  if (!hub) return;
  target.webContents.send(IPC.overlayPush, hub.overlay.layers().map(overlayLayerToView));
}

/** Push a full snapshot (both channels). */
function pushSnapshot(target: BrowserWindow): void {
  pushServices(target);
  pushOverlay(target);
}

function createWindow(activeHub: Hub): void {
  const window = new BrowserWindow({
    width: 980,
    height: 720,
    title: 'AccessAbility Hub',
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.mjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win = window;

  // Re-render the UI whenever the hub's observable state changes.
  const offs = UI_TOPICS.map((topic) =>
    activeHub.kernel.bus.on(topic, () => pushSnapshot(window)),
  );
  window.on('closed', () => {
    for (const off of offs) off();
    if (win === window) win = null;
  });

  // Initial snapshot once the document is ready to receive it.
  window.webContents.once('did-finish-load', () => pushSnapshot(window));

  void window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)));
}

/** renderer -> hub: enable/disable, then re-push the fresh service rows. */
function wireActions(): void {
  ipcMain.handle(IPC.enable, async (_event, id: string) => {
    await hub?.kernel.enable(id);
    if (win) pushServices(win);
  });
  ipcMain.handle(IPC.disable, async (_event, id: string) => {
    await hub?.kernel.disable(id);
    if (win) pushServices(win);
  });
}

app
  .whenReady()
  .then(async () => {
    hub = await createHub();
    wireActions();
    createWindow(hub);

    // macOS convention: re-open a window when the dock icon is clicked.
    app.on('activate', () => {
      if (hub && BrowserWindow.getAllWindows().length === 0) createWindow(hub);
    });
  })
  .catch((err: unknown) => {
    console.error('[shell] failed to start hub:', err);
    app.quit();
  });

// Tear the hub down cleanly before the process exits (releases remotes + leases).
app.on('before-quit', (event) => {
  if (quitting || !hub) return;
  event.preventDefault();
  quitting = true;
  const closing = hub;
  hub = null;
  closing
    .stop()
    .catch((err: unknown) => console.error('[shell] error during shutdown:', err))
    .finally(() => app.quit());
});

app.on('window-all-closed', () => {
  // On macOS apps typically stay alive until Cmd+Q; elsewhere, quit (-> before-quit).
  if (process.platform !== 'darwin') app.quit();
});
