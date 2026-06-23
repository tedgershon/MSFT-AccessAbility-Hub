/**
 * @aah/kernel — the microkernel.
 *
 * Exposes the registry, event bus, resource arbiter, lifecycle manager, supervisor,
 * and config store. The kernel depends only on @aah/contracts.
 */

export { Kernel, type KernelOptions } from './kernel.js';
export { ServiceRegistry, type ServiceRecord } from './registry.js';
export { InMemoryEventBus } from './event-bus.js';
export { InMemoryConfigStore } from './config-store.js';
export {
  ResourceArbiter,
  type LeaseResult,
  type LeaseGrant,
  type LeaseDenial,
} from './resource-arbiter.js';
export { LifecycleManager } from './lifecycle.js';
export { Supervisor, type SupervisorOptions } from './supervisor.js';
