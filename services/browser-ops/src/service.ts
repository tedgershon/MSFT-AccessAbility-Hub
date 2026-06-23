/**
 * Browser-ops service (TS + Playwright).
 *
 * Node-native; same engine ClawPilot uses under the hood. Declares `browser:
 * shared`. Runs out-of-process and communicates only across the event-bus / IPC
 * seam — never via direct function calls into other services.
 */

import {
  type AccessibilityService,
  type Capability,
  cap,
  degraded,
  type HealthStatus,
  healthy,
  type ServiceContext,
  type ServiceMeta,
} from '@aah/contracts';

export class BrowserOpsService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'browser-ops',
    name: 'Browser Operations',
    version: '0.1.0',
  };

  readonly requires: Capability[] = [cap('browser', 'shared')];

  #ctx?: ServiceContext;

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
  }

  async onEnable(): Promise<void> {
    // TODO: launch a Playwright browser context.
  }

  async onDisable(): Promise<void> {
    // TODO: close the Playwright context.
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
  }

  healthCheck(): HealthStatus {
    return this.#ctx ? healthy('browser-ops idle') : degraded('not loaded');
  }
}
