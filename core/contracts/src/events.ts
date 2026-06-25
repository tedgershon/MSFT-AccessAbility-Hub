/**
 * Event bus message contracts.
 *
 * Services NEVER call each other directly. All cross-service communication flows
 * as typed events over the kernel Event Bus (Observer / Pub-Sub). This file is the
 * single source of truth for the event surface.
 */

import type { Capability, Resource } from './capability.js';
import type { HealthStatus } from './health.js';

/** Lifecycle phase a service can be in, as observed by the kernel. */
export type ServicePhase = 'loaded' | 'enabled' | 'disabled' | 'unloaded' | 'degraded';

/**
 * A single renderable layer on the shared overlay surface.
 *
 * Generic by design so unrelated tiles (color correction, live captions, screen
 * dim, ...) all reuse one render channel: `kind` discriminates and `params` carries
 * the kind-specific render data. Contracts stay free of any tile specifics.
 */
export interface OverlayLayer {
  /** Stable id; `overlay/attach`, `overlay/update`, and `overlay/detach` key off it. */
  id: string;
  /** Service that owns the layer, so the surface can scope and clean up by owner. */
  ownerId: string;
  /** Renderer discriminator, e.g. `'color-correction' | 'caption' | 'dim'`. */
  kind: string;
  /** Kind-specific render parameters. */
  params?: Record<string, unknown>;
}

/** Lightweight frame metadata used to correlate sensor and screen context. */
export interface FrameReference {
  sourceServiceId: string;
  /** Epoch time in milliseconds when the frame was captured. */
  capturedAtMs: number;
  /** Optional id to correlate downstream processing output with this frame. */
  frameId?: string;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/** A gaze estimate projected into screen coordinate space. */
export interface GazePoint {
  sourceServiceId: string;
  capturedAtMs: number;
  x: number;
  y: number;
  /** Value in [0, 1], where 1 is highest confidence. */
  confidence: number;
}

/** Calibration state emitted by correlation services. */
export interface CalibrationState {
  sourceServiceId: string;
  capturedAtMs: number;
  state: 'idle' | 'collecting' | 'ready' | 'degraded';
  /** Optional diagnostics for UX or telemetry surfaces. */
  details?: Record<string, unknown>;
}

/** Optional multimodal context attached to an input decision. */
export interface InputContext {
  gaze?: GazePoint;
  calibration?: CalibrationState;
  /** Optional semantic hints produced by stage-B correlation. */
  hints?: Record<string, unknown>;
}

/**
 * The canonical event map: `topic -> payload`. Add a topic here and both the bus
 * and every subscriber stay type-safe.
 */
export interface EventMap {
  'service/phase-changed': { serviceId: string; phase: ServicePhase };
  'service/health': { serviceId: string; status: HealthStatus };
  'arbiter/lease-granted': { serviceId: string; capabilities: Capability[] };
  'arbiter/lease-denied': { serviceId: string; conflictsWith: string[]; resources: Resource[] };
  'arbiter/lease-released': { serviceId: string };
  'coordinator/mode-changed': { channel: string; activeServiceId: string };
  'coordinator/mode-switch-requested': { channel: string; candidates: string[] };
  /** Metadata for a captured camera frame (payload stays out-of-band). */
  'camera/frame-ref': FrameReference;
  /** Metadata for a captured display frame (payload stays out-of-band). */
  'display/frame-ref': FrameReference;
  /** Correlated gaze point in screen coordinates. */
  'gaze/point': GazePoint;
  /** Calibration status updates for gaze-screen mapping. */
  'calibration/state': CalibrationState;
  /** Generic input intent, multiplexed before it ever reaches the OS. */
  'input/intent': { source: string; kind: 'cursor' | 'keyboard'; payload: unknown };
  /** Input intent enriched with optional multimodal context. */
  'input/context': {
    source: string;
    kind: 'cursor' | 'keyboard';
    payload: unknown;
    context?: InputContext;
  };
  /** Mount a renderable layer on the shared overlay surface. */
  'overlay/attach': OverlayLayer;
  /** Replace the content of an already-attached layer (e.g. live captions). */
  'overlay/update': OverlayLayer;
  /** Remove a layer from the overlay surface. */
  'overlay/detach': { id: string; ownerId: string };
}

export type EventTopic = keyof EventMap;
export type EventPayload<T extends EventTopic> = EventMap[T];

/** A subscriber callback for a given topic. */
export type EventHandler<T extends EventTopic> = (payload: EventPayload<T>) => void;

/** Minimal pub/sub surface the kernel exposes to services via DI. */
export interface EventBus {
  emit<T extends EventTopic>(topic: T, payload: EventPayload<T>): void;
  on<T extends EventTopic>(topic: T, handler: EventHandler<T>): () => void;
  off<T extends EventTopic>(topic: T, handler: EventHandler<T>): void;
}
