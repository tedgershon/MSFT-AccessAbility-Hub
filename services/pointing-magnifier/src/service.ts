/**
 * Pointing Magnifier service (issue #22).
 *
 * Pure display overlay — no process, no camera. Declares only `displayOverlay:
 * shared`, so it conflicts with nothing (Interface Segregation: declare only what
 * you touch). Optionally steers toward a gaze-derived `input/target-hint` published
 * by the `eye-tracking` service, without ever holding the (exclusive) camera lease
 * itself.
 *
 * It also realizes an Enhanced Area Cursor (Findlater et al. 2010): the magnified
 * region carries an *activation radius* a renderer paints as an enlarged effective
 * target area, reducing fine-pointing demands. That radius is sized by the active
 * `input/profile` from `input-personalization` (issue #25) — larger for tremor /
 * switch-access — so the two child services of the Input Assist tile (issue #31)
 * cooperate purely over the event bus.
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
  #areaCursorRadiusPx = 0;
  #areaRadiusOverride: number | null = null;
  #unsubscribeHint?: () => void;
  #unsubscribeProfile?: () => void;

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    const configured = ctx.config.get<number>('pointing-magnifier.scale');
    if (configured && configured > 0) this.#scale = configured;
    // An explicit config radius pins the area cursor and ignores profile sizing.
    const radius = ctx.config.get<number>('pointing-magnifier.areaRadius');
    if (typeof radius === 'number' && radius >= 0) {
      this.#areaRadiusOverride = radius;
      this.#areaCursorRadiusPx = radius;
    }
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
      params: this.#params(),
    });
    // Steer toward wherever eye-tracking says the user is looking, if it's running.
    this.#unsubscribeHint = ctx.bus.on('input/target-hint', (hint) => {
      this.#targetHint = hint;
      this.#emitUpdate();
    });
    // Size the area cursor from the active input profile, unless pinned by config.
    this.#unsubscribeProfile = ctx.bus.on('input/profile', ({ profile }) => {
      if (this.#areaRadiusOverride !== null) return;
      const radius = profile.areaCursorRadiusPx;
      if (typeof radius !== 'number' || radius < 0 || radius === this.#areaCursorRadiusPx) return;
      this.#areaCursorRadiusPx = radius;
      this.#emitUpdate();
    });
  }

  async onDisable(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx || !this.#active) return;
    this.#active = false;
    this.#unsubscribeHint?.();
    this.#unsubscribeHint = undefined;
    this.#unsubscribeProfile?.();
    this.#unsubscribeProfile = undefined;
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

  /** Current overlay render parameters. */
  #params(): { scale: number; targetHint: EventPayload<'input/target-hint'> | null; areaCursorRadiusPx: number } {
    return {
      scale: this.#scale,
      targetHint: this.#targetHint,
      areaCursorRadiusPx: this.#areaCursorRadiusPx,
    };
  }

  #emitUpdate(): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#active) return;
    ctx.bus.emit('overlay/update', {
      id: this.#layerId,
      ownerId: ctx.selfId,
      kind: 'pointer-magnifier',
      params: this.#params(),
    });
  }

  /** Stable id for this service's single overlay layer. */
  get #layerId(): string {
    return `${this.meta.id}:magnifier`;
  }
}
