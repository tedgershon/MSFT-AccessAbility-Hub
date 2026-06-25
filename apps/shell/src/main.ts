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
import { app, BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron';
import type { EventTopic } from '@aah/contracts';
import {
  DisplayCaptureAdapter,
  ElectronDisplayCaptureBackend,
  type DesktopCaptureBindings,
} from '@aah/display-capture';
import { TtsAdapter, WebSpeechTtsBackend, type WebSpeechBindings } from '@aah/tts';
import { ArtInSightService, OpenAIVisionDescriber, type SceneDescriber } from '@aah/artinsight';
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
      preload: fileURLToPath(new URL('./preload.js', import.meta.url)),
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
  ipcMain.handle(IPC.describe, async (_event, sourceId?: string) => {
    hub?.kernel.bus.emit('artinsight/describe-requested', { sourceId });
  });
}

/**
 * Build the ArtInSight tile with Electron-backed adapters the headless bootstrap
 * can't construct: screen capture via `desktopCapturer`, and speech routed to the
 * renderer's Web Speech API. The vision describer is config-driven and falls back to
 * a canned describer when no API key is set, so the hub still boots offline.
 */
function buildArtInSightService(): ArtInSightService {
  const captureBindings: DesktopCaptureBindings = {
    async listSources() {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      });
      return sources.map((s) => ({ id: s.id, name: s.name, displayId: s.display_id }));
    },
    async captureFrame(sourceId) {
      const display = screen.getPrimaryDisplay();
      const thumbnailSize = {
        width: Math.round(display.size.width * display.scaleFactor),
        height: Math.round(display.size.height * display.scaleFactor),
      };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
      const match = sources.find((s) => s.id === sourceId) ?? sources[0];
      if (!match) return null;
      const image = match.thumbnail;
      const { width, height } = image.getSize();
      return { capturedAtMs: Date.now(), width, height, data: new Uint8Array(image.toPNG()) };
    },
  };
  const capture = new DisplayCaptureAdapter(new ElectronDisplayCaptureBackend(captureBindings));

  const speechBindings: WebSpeechBindings = {
    speak(text, opts) {
      win?.webContents.send(IPC.speak, {
        text,
        rate: opts?.rate,
        pitch: opts?.pitch,
        voice: opts?.voice,
      });
    },
    cancel() {
      win?.webContents.send(IPC.speakCancel);
    },
  };
  const tts = new TtsAdapter(new WebSpeechTtsBackend(speechBindings));

  return new ArtInSightService({ capture, tts, describer: buildScreenDescriber() });
}

/** Pick a vision describer from env; undefined => the service uses a canned fallback. */
function buildScreenDescriber(): SceneDescriber | undefined {
  const apiKey = process.env.ARTINSIGHT_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  return new OpenAIVisionDescriber({
    apiKey,
    model: process.env.ARTINSIGHT_VISION_MODEL,
    endpoint: process.env.ARTINSIGHT_VISION_ENDPOINT,
  });
}

app
  .whenReady()
  .then(async () => {
    hub = await createHub({ services: [buildArtInSightService()] });
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
