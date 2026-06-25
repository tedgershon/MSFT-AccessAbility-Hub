/**
 * Preload bridge — the ONLY code with access to both Node/Electron and the renderer.
 *
 * Runs with `contextIsolation: true` / `nodeIntegration: false`, so the renderer
 * never touches `ipcRenderer` or Node directly. We expose a small, typed surface on
 * `window.hub` ({@link HubBridge}) over `ipcRenderer`: `on` for main->renderer pushes
 * and `invoke` for renderer->main actions.
 *
 * Imports `electron`, so it is never loaded by unit tests.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type HubBridge, type OverlayLayerView, type ServiceView } from './ui/ipc-contract.js';

const api: HubBridge = {
  onServices(cb) {
    ipcRenderer.on(IPC.servicesPush, (_event, views: ServiceView[]) => cb(views));
  },
  onOverlay(cb) {
    ipcRenderer.on(IPC.overlayPush, (_event, views: OverlayLayerView[]) => cb(views));
  },
  enable(id) {
    return ipcRenderer.invoke(IPC.enable, id) as Promise<void>;
  },
  disable(id) {
    return ipcRenderer.invoke(IPC.disable, id) as Promise<void>;
  },
};

contextBridge.exposeInMainWorld('hub', api);
