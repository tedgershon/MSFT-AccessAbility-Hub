/**
 * Input Personalization service (issue #25).
 *
 * Stores a per-user input-remapping profile (dwell click timing, click-and-hold
 * duration, key-repeat filtering) for motor/dexterity needs. Declares no
 * capabilities: it shapes settings rather than driving cursor/keyboard itself, so
 * it cannot conflict with anything in the Resource Arbiter.
 *
 * It makes the active profile usable two ways: it broadcasts `input/profile` on the
 * bus whenever the profile is selected or changed (so an input-shaping consumer can
 * react without depending on this service), and it hands out a ready-made
 * {@link InputShaper} via {@link InputPersonalizationService.shaper} for an
 * in-process consumer (e.g. a future raw-input capture adapter or the
 * input-injection multiplexer). The dwell stage of that shaper is what turns a gaze
 * `input/target-hint` stream from the eye-tracking service into a deliberate click.
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
import { InputShaper, type InputShaperOptions } from './shaper.js';

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

/** Profile ids selectable at runtime / via config, in control-panel order. */
export const INPUT_PROFILE_IDS: readonly InputProfileId[] = Object.keys(
  PROFILES,
) as InputProfileId[];

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
    // Announce the active profile so input-shaping consumers can pick it up.
    this.#broadcastProfile();
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

  /**
   * Switch the active profile at runtime (e.g. from the control-panel UI). Unknown
   * ids and no-op switches are ignored. When the service is enabled the change is
   * re-broadcast so consumers re-shape input immediately.
   */
  setProfile(id: InputProfileId): void {
    const next = PROFILES[id];
    if (!next || next.id === this.#profile.id) return;
    this.#profile = next;
    if (this.#active) this.#broadcastProfile();
  }

  /** Build an {@link InputShaper} that applies the currently selected profile. */
  shaper(options?: InputShaperOptions): InputShaper {
    return new InputShaper(this.#profile, options);
  }

  #broadcastProfile(): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    ctx.bus.emit('input/profile', { source: ctx.selfId, profile: this.#profile });
  }
}
