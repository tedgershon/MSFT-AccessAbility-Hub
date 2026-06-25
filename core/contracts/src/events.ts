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
  /** Generic input intent, multiplexed before it ever reaches the OS. */
  'input/intent': { source: string; kind: 'cursor' | 'keyboard'; payload: unknown };
  /** A tile requests an on-demand description of what is currently on screen. */
  'artinsight/describe-requested': { sourceId?: string };
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
