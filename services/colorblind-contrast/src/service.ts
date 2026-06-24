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
    const ctx = this.#ctx;
    if (!ctx) return;
    // Mount the correction layer on the shared overlay surface. The host-side
    // OverlaySurface (and, later, the Electron renderer) keys layers by id.
    this.#active = true;
    ctx.bus.emit('overlay/attach', {
      id: this.#layerId,
      ownerId: ctx.selfId,
      kind: 'color-correction',
      params: { strategy: this.#strategy.id },
    });
  }

  async onDisable(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx || !this.#active) return;
    // Tear the correction layer off the overlay surface.
    this.#active = false;
    ctx.bus.emit('overlay/detach', { id: this.#layerId, ownerId: ctx.selfId });
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx) return degraded('not loaded');
    return healthy(this.#active ? `overlay active (${this.#strategy.id})` : 'idle');
  }

  /** Stable id for this service's single overlay layer. */
  get #layerId(): string {
    return `${this.meta.id}:correction`;
  }
}
