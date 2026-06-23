/**
 * Lifecycle Manager.
 *
 * Drives the onLoad → onEnable → onDisable → onUnload transitions, coordinating
 * with the Resource Arbiter so a service only *enables* once its lease is granted.
 * Camera/mic leases are released on disable (contract rule 5).
 */

import type { AccessibilityService, ServiceContext } from '@aah/contracts';
import type { ResourceArbiter } from './resource-arbiter.js';
import type { ServiceRegistry } from './registry.js';

export class LifecycleManager {
  constructor(
    private readonly registry: ServiceRegistry,
    private readonly arbiter: ResourceArbiter,
    private readonly makeContext: (service: AccessibilityService) => ServiceContext,
  ) {}

  async load(service: AccessibilityService): Promise<void> {
    this.registry.register(service);
    await service.onLoad(this.makeContext(service));
    this.registry.setPhase(service.meta.id, 'loaded');
  }

  /**
   * Acquire the lease then start. Returns the arbiter result so the shell can
   * surface a mode-switch when an exclusive collision is detected.
   */
  async enable(id: string): Promise<{ enabled: boolean; reason?: string }> {
    const record = this.required(id);
    const result = this.arbiter.request(id, record.service.requires);
    if (!result.ok) {
      return {
        enabled: false,
        reason: `resource conflict on [${result.resources.join(', ')}] with [${result.conflictsWith.join(', ')}]`,
      };
    }
    await record.service.onEnable();
    this.registry.setPhase(id, 'enabled');
    return { enabled: true };
  }

  async disable(id: string): Promise<void> {
    const record = this.required(id);
    await record.service.onDisable();
    this.arbiter.release(id); // releases camera/mic/etc. leases
    this.registry.setPhase(id, 'disabled');
  }

  async unload(id: string): Promise<void> {
    const record = this.required(id);
    if (record.phase === 'enabled') await this.disable(id);
    await record.service.onUnload();
    this.registry.setPhase(id, 'unloaded');
    this.registry.unregister(id);
  }

  private required(id: string) {
    const record = this.registry.get(id);
    if (!record) throw new Error(`Unknown service "${id}".`);
    return record;
  }
}
