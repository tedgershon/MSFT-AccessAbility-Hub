/**
 * Supervisor.
 *
 * Polls each enabled service's `healthCheck()`. Unhealthy services are restarted
 * with exponential backoff; repeated failure trips a circuit breaker and the
 * service is marked `degraded` (the shell shows it as such) while everything else
 * keeps running. Graceful degradation is non-negotiable for accessibility.
 */

import type { EventBus } from '@aah/contracts';
import type { LifecycleManager } from './lifecycle.js';
import type { ServiceRegistry } from './registry.js';

export interface SupervisorOptions {
  pollIntervalMs?: number;
  baseBackoffMs?: number;
  /** Consecutive failed restarts before the circuit breaker trips. */
  failureThreshold?: number;
}

interface BreakerState {
  failures: number;
  open: boolean;
}

export class Supervisor {
  readonly #breakers = new Map<string, BreakerState>();
  #timer: ReturnType<typeof setInterval> | undefined;

  private readonly pollIntervalMs: number;
  private readonly baseBackoffMs: number;
  private readonly failureThreshold: number;

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly lifecycle: LifecycleManager,
    private readonly bus: EventBus,
    opts: SupervisorOptions = {},
  ) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
    this.baseBackoffMs = opts.baseBackoffMs ?? 500;
    this.failureThreshold = opts.failureThreshold ?? 3;
  }

  start(): void {
    this.#timer ??= setInterval(() => void this.tick(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** One supervision pass. Exposed for tests so they can drive it deterministically. */
  async tick(): Promise<void> {
    for (const record of this.registry.list()) {
      if (record.phase !== 'enabled') continue;
      const status = record.service.healthCheck();
      this.bus.emit('service/health', { serviceId: record.service.meta.id, status });
      if (status.state === 'unhealthy') {
        await this.recover(record.service.meta.id);
      }
    }
  }

  private async recover(id: string): Promise<void> {
    const breaker = this.#breakers.get(id) ?? { failures: 0, open: false };
    if (breaker.open) return;

    try {
      await this.lifecycle.disable(id);
      await this.backoff(breaker.failures);
      await this.lifecycle.enable(id);
      this.#breakers.set(id, { failures: 0, open: false });
    } catch {
      breaker.failures += 1;
      if (breaker.failures >= this.failureThreshold) {
        breaker.open = true;
        this.registry.setPhase(id, 'degraded');
        this.bus.emit('service/phase-changed', { serviceId: id, phase: 'degraded' });
      }
      this.#breakers.set(id, breaker);
    }
  }

  private backoff(attempt: number): Promise<void> {
    const delay = this.baseBackoffMs * 2 ** attempt;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }
}
