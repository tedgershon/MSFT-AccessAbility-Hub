/**
 * Input Personalization service (issue #25).
 *
 * Stores a per-user input-remapping profile (dwell click timing, click-and-hold
 * duration, key-repeat filtering) for motor/dexterity needs. Declares no
 * capabilities: it shapes settings rather than driving cursor/keyboard itself, so
 * it cannot conflict with anything in the Resource Arbiter. A future raw-input
 * capture adapter or the `input-injection` multiplexer would consult `profile()`
 * before shaping intents; wiring that consumer is out of scope here.
 */

import {
  type AccessibilityService,
  type Capability,
  degraded,
  type HealthStatus,
  healthy,
  type ServiceContext,
  type ServiceMeta,
} from '@aah/contracts';

export type InputProfileId = 'default' | 'tremor' | 'switch-access';

export interface InputProfile {
  id: InputProfileId;
  /** Time the pointer must hover a target before a dwell-click fires. */
  dwellMs: number;
  /** Time a press must be held before it counts as a deliberate click-and-hold. */
  clickHoldMs: number;
  /** Suppress repeated keydown events firing within this window (debounce). */
  keyRepeatFilterMs: number;
}

const PROFILES: Record<InputProfileId, InputProfile> = {
  default: { id: 'default', dwellMs: 0, clickHoldMs: 0, keyRepeatFilterMs: 0 },
  tremor: { id: 'tremor', dwellMs: 400, clickHoldMs: 250, keyRepeatFilterMs: 120 },
  'switch-access': { id: 'switch-access', dwellMs: 800, clickHoldMs: 500, keyRepeatFilterMs: 200 },
};

export class InputPersonalizationService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'input-personalization',
    name: 'Input Personalization',
    version: '0.1.0',
  };

  readonly requires: Capability[] = [];

  #ctx?: ServiceContext;
  #profile: InputProfile = PROFILES.default;
  #active = false;

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    const configured = ctx.config.get<InputProfileId>('input-personalization.profile');
    if (configured && PROFILES[configured]) this.#profile = PROFILES[configured];
  }

  async onEnable(): Promise<void> {
    this.#active = true;
  }

  async onDisable(): Promise<void> {
    this.#active = false;
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx) return degraded('not loaded');
    return healthy(this.#active ? `active (profile=${this.#profile.id})` : 'idle');
  }

  /** The currently selected remapping profile. */
  profile(): InputProfile {
    return this.#profile;
  }
}
