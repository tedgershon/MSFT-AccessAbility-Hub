/**
 * Colorblind / contrast correction service.
 *
 * Pure display overlay — no process, no camera. Declares only `displayOverlay:
 * shared`, so it conflicts with nothing (Interface Segregation: declare only what
 * you touch). Uses the Strategy pattern to swap correction algorithms.
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
import { STRATEGIES, type CorrectionStrategy } from './strategies.js';

export class ColorblindContrastService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'colorblind-contrast',
    name: 'Colorblind / Contrast Correction',
    version: '0.1.0',
  };

  readonly requires: Capability[] = [cap('displayOverlay', 'shared')];

  #ctx?: ServiceContext;
  #strategy: CorrectionStrategy = STRATEGIES.deuteranopia;
  #active = false;

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    const configured = ctx.config.get<string>('colorblind.strategy');
    if (configured && STRATEGIES[configured]) this.#strategy = STRATEGIES[configured];
  }

  async onEnable(): Promise<void> {
    // Surface the overlay over the bus seam (the service has no renderer handle).
    // The shell/renderer observes `service/health` and mounts/refreshes the overlay
    // when this service reports an active correction strategy.
    this.#active = true;
    this.#publishOverlayState();
  }

  async onDisable(): Promise<void> {
    // Detach: flip internal state and re-publish so observers tear the overlay down.
    this.#active = false;
    this.#publishOverlayState();
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx) return degraded('not loaded');
    return this.#overlayStatus();
  }

  /** Current overlay state as a HealthStatus (single source for health + bus). */
  #overlayStatus(): HealthStatus {
    return healthy(this.#active ? `overlay active (${this.#strategy.id})` : 'idle');
  }

  /** Announce the overlay attach/detach over the bus the kernel injected. */
  #publishOverlayState(): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    ctx.bus.emit('service/health', {
      serviceId: ctx.selfId,
      status: this.#overlayStatus(),
    });
  }
}
