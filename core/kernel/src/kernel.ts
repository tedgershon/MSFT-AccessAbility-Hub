/**
 * Kernel — the microkernel facade that wires the parts together via Dependency
 * Injection and exposes a small surface to the shell.
 *
 * The kernel knows nothing about specific disabilities; it only knows the service
 * contract. Adding a new service never requires editing this file (Open/Closed).
 */

import type { AccessibilityService, ServiceContext } from '@aah/contracts';
import { InMemoryConfigStore } from './config-store.js';
import { InMemoryEventBus } from './event-bus.js';
import { LifecycleManager } from './lifecycle.js';
import { ServiceRegistry } from './registry.js';
import { ResourceArbiter } from './resource-arbiter.js';
import { Supervisor, type SupervisorOptions } from './supervisor.js';

export interface KernelOptions {
  supervisor?: SupervisorOptions;
}

export class Kernel {
  readonly bus = new InMemoryEventBus();
  readonly config = new InMemoryConfigStore();
  readonly registry = new ServiceRegistry();
  readonly arbiter = new ResourceArbiter(this.bus);
  readonly lifecycle: LifecycleManager;
  readonly supervisor: Supervisor;

  constructor(opts: KernelOptions = {}) {
    this.lifecycle = new LifecycleManager(this.registry, this.arbiter, (service) =>
      this.contextFor(service),
    );
    this.supervisor = new Supervisor(
      this.registry,
      this.lifecycle,
      this.bus,
      opts.supervisor,
    );
  }

  /** Register + onLoad a service. */
  async install(service: AccessibilityService): Promise<void> {
    await this.lifecycle.load(service);
  }

  /** Toggle a service on (arbiter-gated). */
  enable(id: string) {
    return this.lifecycle.enable(id);
  }

  /** Toggle a service off (releases its leases). */
  disable(id: string) {
    return this.lifecycle.disable(id);
  }

  start(): void {
    this.supervisor.start();
  }

  async shutdown(): Promise<void> {
    this.supervisor.stop();
    for (const id of this.registry.ids()) {
      await this.lifecycle.unload(id);
    }
  }

  /** Build the per-service injected context (DI seam). */
  private contextFor(service: AccessibilityService): ServiceContext {
    return {
      bus: this.bus,
      config: this.config,
      selfId: service.meta.id,
    };
  }
}
