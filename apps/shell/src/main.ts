/**
 * Electron main entry. Owns the OS-level window and the privileged host process
 * (input injection + accessibility APIs a browser sandbox forbids).
 *
 * Scaffold: creates the hub and a window. Renderer/IPC wiring is left as TODO.
 */

import { app, BrowserWindow, desktopCapturer } from 'electron';
import { DisplayCaptureAdapter, ElectronDisplayCaptureBackend } from '@aah/display-capture';
import { createHub } from './bootstrap.js';
import { DisplayFramePublisher } from './display-frame-publisher.js';
import { startPythonServices } from './python-services.js';

function createDesktopCaptureBindings(): {
  listSources(): Promise<Array<{ id: string; name: string; displayId?: string; thumbnailDataUrl?: string }>>;
  captureFrame(
    sourceId: string,
  ): Promise<{ capturedAtMs: number; width: number; height: number; data: Uint8Array } | null>;
} {
  return {
    async listSources() {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 640, height: 360 },
      });
      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        displayId: source.display_id || undefined,
        thumbnailDataUrl: source.thumbnail.toDataURL(),
      }));
    },
    async captureFrame(sourceId: string) {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1280, height: 720 },
      });
      const source = sources.find((candidate) => candidate.id === sourceId);
      if (!source) {
        return null;
      }
      const image = source.thumbnail;
      const png = image.toPNG();
      const size = image.getSize();
      return {
        capturedAtMs: Date.now(),
        width: size.width,
        height: size.height,
        data: new Uint8Array(png),
      };
    },
  };
}

async function main(): Promise<void> {
  await app.whenReady();
  const hub = await createHub();
  const displayCapture = new DisplayCaptureAdapter(
    new ElectronDisplayCaptureBackend(createDesktopCaptureBindings()),
  );
  const displayPublisher = new DisplayFramePublisher(hub.kernel.bus, displayCapture);

  const displaySources = await displayCapture.listSources();
  const primaryDisplay = displaySources[0];
  if (primaryDisplay) {
    await displayPublisher.start(primaryDisplay.id, 250);
  } else {
    console.warn('No display capture source available; frame publishing is disabled.');
  }

  // Attach the out-of-process Python services (eye tracking, gaze correlation) to
  // the kernel bus over the IPC seam. They run as child processes; the bridge keeps
  // them decoupled from in-shell TS services.
  const pythonServices = startPythonServices(hub.kernel.bus);

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

  app.on('window-all-closed', () => {
    pythonServices.stop();
    void displayPublisher.stop().finally(() => {
      void hub.kernel.shutdown().finally(() => app.quit());
    });
  });
}

void main();
