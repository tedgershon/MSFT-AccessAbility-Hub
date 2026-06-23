/**
 * Service Registry.
 *
 * The kernel's catalogue of known services. It stores the contract instance plus
 * the kernel's view of its lifecycle phase. The registry is pure bookkeeping — it
 * does not start, stop, or arbitrate anything.
 */

import type { AccessibilityService, ServicePhase } from '@aah/contracts';

export interface ServiceRecord {
  service: AccessibilityService;
  phase: ServicePhase;
}

export class ServiceRegistry {
  readonly #records = new Map<string, ServiceRecord>();

  register(service: AccessibilityService): void {
    const id = service.meta.id;
    if (this.#records.has(id)) {
      throw new Error(`Service "${id}" is already registered.`);
    }
    this.#records.set(id, { service, phase: 'loaded' });
  }

  unregister(id: string): void {
    this.#records.delete(id);
  }

  get(id: string): ServiceRecord | undefined {
    return this.#records.get(id);
  }

  setPhase(id: string, phase: ServicePhase): void {
    const record = this.#records.get(id);
    if (!record) throw new Error(`Unknown service "${id}".`);
    record.phase = phase;
  }

  list(): ServiceRecord[] {
    return [...this.#records.values()];
  }

  ids(): string[] {
    return [...this.#records.keys()];
  }
}
