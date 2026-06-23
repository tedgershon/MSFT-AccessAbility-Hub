/**
 * __SERVICE_NAME__ service.
 *
 * Implements the kernel contract. Depends ONLY on @aah/contracts + the injected
 * event bus — never import another service. Declare just the resources you touch.
 */

import {
  type AccessibilityService,
  type Capability,
  // import { cap } from '@aah/contracts' and use e.g. cap('camera', 'exclusive')
  type HealthStatus,
  healthy,
  type ServiceContext,
  type ServiceMeta,
} from '@aah/contracts';

export class __SERVICE_CLASS__Service implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: '__SERVICE_ID__',
    name: '__SERVICE_NAME__',
    version: '0.1.0',
  };

  // Declare ONLY the resources you touch. exclusive = sole holder; shared = co-exist.
  // e.g. [cap('camera', 'exclusive'), cap('cursor', 'shared')]
  readonly requires: Capability[] = [];

  #ctx?: ServiceContext;

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
  }

  async onEnable(): Promise<void> {
    // TODO: acquire resources and start.
  }

  async onDisable(): Promise<void> {
    // TODO: stop and RELEASE every lease here (camera/mic rule).
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
  }

  healthCheck(): HealthStatus {
    return healthy('__SERVICE_ID__ idle');
  }
}
