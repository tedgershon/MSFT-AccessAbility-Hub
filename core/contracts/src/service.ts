/**
 * The service contract.
 *
 * Every accessibility service implements exactly this interface and declares the
 * resources it needs up front (`requires`). The kernel depends ONLY on this
 * contract — never on a concrete service (Dependency Inversion).
 */

import type { Capability } from './capability.js';
import type { EventBus } from './events.js';
import type { HealthStatus } from './health.js';

export interface ServiceMeta {
  id: string;
  name: string;
  version: string;
}

/** Read-only key/value config + state view injected into a service. */
export interface ConfigStore {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
}

/**
 * Everything the kernel injects into a service at load time (Dependency Injection).
 * A service may use the bus and config — but must never reach for another service.
 */
export interface ServiceContext {
  bus: EventBus;
  config: ConfigStore;
  /** The id the kernel registered this service under. */
  selfId: string;
}

/**
 * Lifecycle interface implemented by every service.
 *
 * Lifecycle order: onLoad -> onEnable -> (running) -> onDisable -> onUnload.
 * - onLoad: register, no side effects.
 * - onEnable: acquire resources, start.
 * - onDisable: release resources, stop. Camera/mic leases MUST be released here.
 * - onUnload: final teardown.
 */
export interface AccessibilityService {
  readonly meta: ServiceMeta;

  /** Declarative manifest — drives conflict detection in the Resource Arbiter. */
  readonly requires: Capability[];

  onLoad(ctx: ServiceContext): Promise<void>;
  onEnable(): Promise<void>;
  onDisable(): Promise<void>;
  onUnload(): Promise<void>;
  healthCheck(): HealthStatus;
}
