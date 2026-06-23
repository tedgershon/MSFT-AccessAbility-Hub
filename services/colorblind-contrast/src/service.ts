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
    // TODO: attach the display overlay and begin per-frame correction.
    this.#active = true;
  }

  async onDisable(): Promise<void> {
    // TODO: detach the overlay.
    this.#active = false;
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
  }

  healthCheck(): HealthStatus {
    return healthy(this.#active ? `overlay active (${this.#strategy.id})` : 'idle');
  }
}
