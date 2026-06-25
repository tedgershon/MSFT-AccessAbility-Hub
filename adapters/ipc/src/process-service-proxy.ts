/**
 * ProcessServiceProxy — a host-side {@link AccessibilityService} standing in for an
 * out-of-process (e.g. Python) service.
 *
 * The kernel treats this exactly like an in-process service: it has `meta`,
 * `requires`, the lifecycle hooks, and a synchronous `healthCheck()`. `meta` and
 * `requires` are known host-side so the Resource Arbiter needs no round-trip to the
 * child.
 *
 * - Lifecycle hooks are fire-and-forget: they send the matching `lifecycle` frame and
 *   resolve immediately (the child drives its own async work over the seam).
 * - Health is push-based: the proxy caches the latest `health` frame from the child
 *   and `healthCheck()` returns it, defaulting to `degraded` until the first report.
 */

import {
  type AccessibilityService,
  type Capability,
  degraded,
  type HealthStatus,
  type ServiceContext,
  type ServiceMeta,
} from '@aah/contracts';
import type { Channel } from './channel.js';

export class ProcessServiceProxy implements AccessibilityService {
  readonly meta: ServiceMeta;
  readonly requires: Capability[];
  readonly #channel: Channel;
  #health: HealthStatus = degraded('remote service not started');
  #unsub?: () => void;

  constructor(meta: ServiceMeta, requires: Capability[], channel: Channel) {
    this.meta = meta;
    this.requires = requires;
    this.#channel = channel;
    this.#unsub = channel.onMessage((frame) => {
      if (frame.kind === 'health') this.#health = frame.status;
    });
  }

  async onLoad(_ctx: ServiceContext): Promise<void> {
    this.#channel.send({ kind: 'lifecycle', phase: 'load' });
  }

  async onEnable(): Promise<void> {
    this.#channel.send({ kind: 'lifecycle', phase: 'enable' });
  }

  async onDisable(): Promise<void> {
    this.#channel.send({ kind: 'lifecycle', phase: 'disable' });
  }

  async onUnload(): Promise<void> {
    this.#channel.send({ kind: 'lifecycle', phase: 'unload' });
    this.#unsub?.();
    this.#unsub = undefined;
  }

  healthCheck(): HealthStatus {
    return this.#health;
  }
}
