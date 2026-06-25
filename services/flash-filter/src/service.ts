/**
 * Flash Filter — photosensitive-epilepsy guard ("Scout").
 *
 * A protective display buffer for photosensitive epilepsy: it watches on-screen
 * luminance and, the moment seizure-triggering flashing is detected, raises a dim
 * filter layer over the screen — softening the strobe before it reaches the user.
 *
 * Like the colorblind/contrast tile this is a pure display-overlay service: it
 * declares only `displayOverlay: shared` and never drives input. There is no
 * screen-capture Resource in the contract's closed union, so the host/adapter feeds
 * relative-luminance samples in via {@link FlashFilterService.ingestLuminance};
 * detection and the protective layer live here.
 *
 * Strategy pattern (see {@link FilterStrategy}) decouples *how hard we dim* from
 * *how we detect* (see {@link FlashDetector}).
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
import {
  FlashDetector,
  SENSITIVITY_PROFILES,
  type FlashReading,
  type SensitivityProfile,
} from './detector.js';
import { STRATEGIES, type FilterStrategy } from './strategies.js';

/** Intensity changes smaller than this don't warrant an overlay update. */
const INTENSITY_EPSILON = 0.01;

export class FlashFilterService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'flash-filter',
    name: 'Flash Filter — Photosensitive Protection',
    version: '0.1.0',
  };

  // Pure overlay tile: no camera, no process, no input. Shares the overlay surface
  // with other tiles (Interface Segregation: declare only what you touch).
  readonly requires: Capability[] = [cap('displayOverlay', 'shared')];

  #ctx?: ServiceContext;
  #profile: SensitivityProfile = SENSITIVITY_PROFILES.standard;
  #strategy: FilterStrategy = STRATEGIES['adaptive-dim'];
  #detector = new FlashDetector(SENSITIVITY_PROFILES.standard);
  #active = false;
  #intensity = 0;
  #lastReading: FlashReading = { flashesPerSecond: 0, risk: false };

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;

    const profileId = ctx.config.get<string>('flashFilter.sensitivity');
    if (profileId && SENSITIVITY_PROFILES[profileId]) {
      this.#profile = SENSITIVITY_PROFILES[profileId];
    }

    const strategyId = ctx.config.get<string>('flashFilter.strategy');
    if (strategyId && STRATEGIES[strategyId]) this.#strategy = STRATEGIES[strategyId];

    this.#detector = new FlashDetector(this.#profile);
  }

  async onEnable(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx) return;
    this.#active = true;
    this.#intensity = 0;
    this.#lastReading = { flashesPerSecond: 0, risk: false };
    this.#detector.reset();
    // Mount the protective buffer, transparent until flashing is detected.
    ctx.bus.emit('overlay/attach', {
      id: this.#layerId,
      ownerId: ctx.selfId,
      kind: 'flash-guard',
      params: this.#renderParams(),
    });
  }

  async onDisable(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx || !this.#active) return;
    this.#active = false;
    this.#intensity = 0;
    // Take the protective layer off the overlay surface.
    ctx.bus.emit('overlay/detach', { id: this.#layerId, ownerId: ctx.selfId });
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
  }

  /**
   * Feed one relative-luminance sample (0..1) sampled from the screen at `atMs`
   * (defaults to now). Runs detection and, when the resulting dim intensity changes,
   * updates the protective overlay layer. No-op until the service is enabled.
   */
  ingestLuminance(luminance: number, atMs: number = Date.now()): FlashReading {
    if (!this.#active || !this.#ctx) return this.#lastReading;

    const reading = this.#detector.sample(luminance, atMs);
    this.#lastReading = reading;

    const next = clamp01(this.#strategy.intensity(reading));
    if (Math.abs(next - this.#intensity) >= INTENSITY_EPSILON) {
      this.#intensity = next;
      this.#ctx.bus.emit('overlay/update', {
        id: this.#layerId,
        ownerId: this.#ctx.selfId,
        kind: 'flash-guard',
        params: this.#renderParams(),
      });
    }
    return reading;
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx) return degraded('not loaded');
    if (!this.#active) return healthy('idle');
    const fps = this.#lastReading.flashesPerSecond;
    return healthy(
      this.#lastReading.risk
        ? `guarding (${fps} flashes/s, dim ${this.#intensity.toFixed(2)})`
        : `monitoring (${this.#profile.id})`,
    );
  }

  #renderParams(): Record<string, unknown> {
    return {
      intensity: this.#intensity,
      strategy: this.#strategy.id,
      sensitivity: this.#profile.id,
      flashesPerSecond: this.#lastReading.flashesPerSecond,
    };
  }

  /** Stable id for this service's single overlay layer. */
  get #layerId(): string {
    return `${this.meta.id}:guard`;
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
