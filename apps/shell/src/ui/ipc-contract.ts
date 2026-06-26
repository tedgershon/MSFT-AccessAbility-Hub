/**
 * IPC contract shared by the Electron main process, the preload bridge, and the
 * renderer.
 *
 * This module is PURE: it imports nothing from `electron`, `node`, or the DOM — only
 * type-level shapes from `@aah/contracts`. Keeping the channel names + message types
 * in one transport-agnostic place lets main/preload/renderer all type-check against
 * the same surface, and lets the view-model be unit-tested under plain Node/vitest.
 */

import type { HealthState, ServicePhase } from '@aah/contracts';

/**
 * Channel names used across the IPC seam.
 *
 * - `main -> renderer` (pushes, over `webContents.send` / `ipcRenderer.on`):
 *   {@link IPC.servicesPush}, {@link IPC.overlayPush}.
 * - `renderer -> main` (actions, over `ipcRenderer.invoke` / `ipcMain.handle`):
 *   {@link IPC.enable}, {@link IPC.disable}.
 */
export const IPC = {
  /** main -> renderer: full snapshot of service rows. Payload: {@link ServiceView}[]. */
  servicesPush: 'hub:services',
  /** main -> renderer: full snapshot of overlay layers. Payload: {@link OverlayLayerView}[]. */
  overlayPush: 'hub:overlay',
  /** renderer -> main: request to enable a service by id. */
  enable: 'hub:enable',
  /** renderer -> main: request to disable a service by id. */
  disable: 'hub:disable',
  /** renderer -> main: request a description of what is currently on screen. */
  describe: 'hub:describe',
  /** renderer -> main: scan the current screen for private info before sharing. */
  scan: 'hub:scan',
  /** main -> renderer: speak some text via the Web Speech API. Payload: {@link SpeakRequest}. */
  speak: 'hub:speak',
  /** main -> renderer: cancel any in-progress speech. */
  speakCancel: 'hub:speak-cancel',
} as const;

/** Presentation-ready view of a service's health. */
export interface HealthView {
  state: HealthState;
  detail?: string;
}

/** A single service row the renderer paints (name, phase, health + a toggle). */
export interface ServiceView {
  id: string;
  name: string;
  phase: ServicePhase;
  health: HealthView;
}

/**
 * A serialisable snapshot of one overlay layer. Mirrors `OverlayLayer` from
 * contracts but is intentionally re-declared here so the renderer never has to
 * import the contracts package at runtime.
 */
export interface OverlayLayerView {
  id: string;
  ownerId: string;
  kind: string;
  params?: Record<string, unknown>;
}

/** A request to voice some text in the renderer via the Web Speech API. */
export interface SpeakRequest {
  text: string;
  rate?: number;
  pitch?: number;
  voice?: string;
}

/**
 * The safe, typed API the preload script exposes on `window.hub` via
 * `contextBridge`. The renderer programs against this interface only.
 */
export interface HubBridge {
  /** Subscribe to service-list snapshots pushed by the main process. */
  onServices(cb: (views: ServiceView[]) => void): void;
  /** Subscribe to overlay-layer snapshots pushed by the main process. */
  onOverlay(cb: (views: OverlayLayerView[]) => void): void;
  /** Ask the hub to enable a service. */
  enable(id: string): Promise<void>;
  /** Ask the hub to disable a service. */
  disable(id: string): Promise<void>;
  /** Ask the hub to describe what is currently on screen. */
  describe(sourceId?: string): Promise<void>;
  /** Ask the hub to scan the current screen for private info before sharing. */
  scan(sourceId?: string): Promise<void>;
  /** Subscribe to speak requests (text voiced via the Web Speech API). */
  onSpeak(cb: (req: SpeakRequest) => void): void;
  /** Subscribe to cancel-speech requests. */
  onSpeakCancel(cb: () => void): void;
}
