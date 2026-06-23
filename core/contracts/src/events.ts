/**
 * Event bus message contracts.
 *
 * Services NEVER call each other directly. All cross-service communication flows
 * as typed events over the kernel Event Bus (Observer / Pub-Sub). This file is the
 * single source of truth for the event surface.
 */

import type { Capability } from './capability.js';
import type { HealthStatus } from './health.js';

/** Lifecycle phase a service can be in, as observed by the kernel. */
export type ServicePhase = 'loaded' | 'enabled' | 'disabled' | 'unloaded' | 'degraded';

/**
 * The canonical event map: `topic -> payload`. Add a topic here and both the bus
 * and every subscriber stay type-safe.
 */
export interface EventMap {
  'service/phase-changed': { serviceId: string; phase: ServicePhase };
  'service/health': { serviceId: string; status: HealthStatus };
  'arbiter/lease-granted': { serviceId: string; capabilities: Capability[] };
  'arbiter/lease-denied': { serviceId: string; conflictsWith: string[] };
  'arbiter/lease-released': { serviceId: string };
  'coordinator/mode-changed': { channel: string; activeServiceId: string };
  'coordinator/mode-switch-requested': { channel: string; candidates: string[] };
  /** Generic input intent, multiplexed before it ever reaches the OS. */
  'input/intent': { source: string; kind: 'cursor' | 'keyboard'; payload: unknown };
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
