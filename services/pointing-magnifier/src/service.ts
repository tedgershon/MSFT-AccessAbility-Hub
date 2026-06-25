/**
 * Pointing Magnifier service (issue #22).
 *
 * Pure display overlay — no process, no camera. Declares only `displayOverlay:
 * shared`, so it conflicts with nothing (Interface Segregation: declare only what
 * you touch). Optionally steers toward a gaze-derived `input/target-hint` published
 * by the `eye-tracking` service, without ever holding the (exclusive) camera lease
 * itself.
 */

import {
  type AccessibilityService,
  type Capability,
  cap,
  degraded,
  type EventPayload,
  type HealthStatus,
  healthy,
  type ServiceContext,
  type ServiceMeta,
} from '@aah/contracts';

const DEFAULT_SCALE = 2;

export class PointingMagnifierService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'pointing-magnifier',
    name: 'Pointing Magnifier',
    version: '0.1.0',
  };

  readonly requires: Capability[] = [cap('displayOverlay', 'shared')];

  #ctx?: ServiceContext;
  #scale = DEFAULT_SCALE;
  #active = false;
  #targetHint: EventPayload<'input/target-hint'> | null = null;
  #unsubscribeHint?: () => void;

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    const configured = ctx.config.get<number>('pointing-magnifier.scale');
    if (configured && configured > 0) this.#scale = configured;
  }

  async onEnable(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx) return;
    this.#active = true;
    this.#targetHint = null;
    ctx.bus.emit('overlay/attach', {
      id: this.#layerId,
      ownerId: ctx.selfId,
      kind: 'pointer-magnifier',
      params: { scale: this.#scale, targetHint: null },
    });
    // Steer toward wherever eye-tracking says the user is looking, if it's running.
    this.#unsubscribeHint = ctx.bus.on('input/target-hint', (hint) => {
      this.#targetHint = hint;
      ctx.bus.emit('overlay/update', {
        id: this.#layerId,
        ownerId: ctx.selfId,
        kind: 'pointer-magnifier',
        params: { scale: this.#scale, targetHint: hint },
      });
    });
  }

  async onDisable(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx || !this.#active) return;
    this.#active = false;
    this.#unsubscribeHint?.();
    this.#unsubscribeHint = undefined;
    ctx.bus.emit('overlay/detach', { id: this.#layerId, ownerId: ctx.selfId });
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx) return degraded('not loaded');
    if (!this.#active) return healthy('idle');
    return healthy(
      this.#targetHint
        ? `overlay active (scale=${this.#scale}, hinted)`
        : `overlay active (scale=${this.#scale})`,
    );
  }

  /** Stable id for this service's single overlay layer. */
  get #layerId(): string {
    return `${this.meta.id}:magnifier`;
  }
}
