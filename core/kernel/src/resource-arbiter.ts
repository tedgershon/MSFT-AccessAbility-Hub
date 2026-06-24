/**
 * Resource Arbiter — Broker / Lease manager.
 *
 * On toggle-on, the arbiter compares a service's `requires` manifest against the
 * leases currently held. Compatible (all `shared` or disjoint) → granted. An
 * `exclusive` collision is escalated, never silently double-bound.
 *
 * This handles *resource contention*. Semantic/control conflicts (two services both
 * wanting to DRIVE a channel) are escalated to the Mode Coordinator instead.
 */

import type { Capability, EventBus, Resource } from '@aah/contracts';

interface Lease {
  resource: Resource;
  mode: Capability['mode'];
  holder: string;
}

export interface LeaseGrant {
  ok: true;
}

export interface LeaseDenial {
  ok: false;
  /** Service ids already holding a lease that conflicts with the request. */
  conflictsWith: string[];
  /** The specific resources that collided. */
  resources: Resource[];
}

export type LeaseResult = LeaseGrant | LeaseDenial;

export class ResourceArbiter {
  readonly #leases: Lease[] = [];

  constructor(private readonly bus: EventBus) {}

  /**
   * Try to acquire every capability in `requires` atomically for `serviceId`.
   * All-or-nothing: if any single capability collides, nothing is granted.
   */
  request(serviceId: string, requires: readonly Capability[]): LeaseResult {
    const conflicts = new Map<string, Set<Resource>>();

    for (const want of requires) {
      for (const held of this.#leases) {
        if (held.resource !== want.resource) continue;
        // exclusive on either side ⇒ collision; shared+shared is fine.
        if (held.mode === 'exclusive' || want.mode === 'exclusive') {
          if (!conflicts.has(held.holder)) conflicts.set(held.holder, new Set());
          conflicts.get(held.holder)!.add(want.resource);
        }
      }
    }

    if (conflicts.size > 0) {
      const conflictsWith = [...conflicts.keys()];
      const resources = [...new Set([...conflicts.values()].flatMap((s) => [...s]))];
      this.bus.emit('arbiter/lease-denied', { serviceId, conflictsWith, resources });
      return { ok: false, conflictsWith, resources };
    }

    for (const want of requires) {
      this.#leases.push({ resource: want.resource, mode: want.mode, holder: serviceId });
    }
    this.bus.emit('arbiter/lease-granted', {
      serviceId,
      capabilities: [...requires],
    });
    return { ok: true };
  }

  /** Release every lease held by a service (called from onDisable / supervisor). */
  release(serviceId: string): void {
    for (let i = this.#leases.length - 1; i >= 0; i--) {
      if (this.#leases[i].holder === serviceId) this.#leases.splice(i, 1);
    }
    this.bus.emit('arbiter/lease-released', { serviceId });
  }

  /** Current holders of a given resource — used by the coordinator. */
  holdersOf(resource: Resource): string[] {
    return this.#leases.filter((l) => l.resource === resource).map((l) => l.holder);
  }
}
