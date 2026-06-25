/**
 * Flash detection engine for the photosensitive-epilepsy guard.
 *
 * Pure, host-agnostic luminance analysis: the service feeds in relative-luminance
 * samples (0..1) taken from the screen, and the detector reports how many
 * seizure-relevant "flashes" occurred in the trailing one-second window. A flash is
 * a *pair* of opposing luminance changes (a rise then a fall, or vice versa),
 * following the WCAG / IEC general flash threshold where more than three flashes per
 * second is considered a risk.
 *
 * Kept free of any overlay / event concerns so it can be unit-tested in isolation
 * and reused behind different filter strategies.
 */

/** Tunable thresholds that define how aggressively flashing is flagged. */
export interface SensitivityProfile {
  /** Id used in config + health reporting. */
  readonly id: string;
  /**
   * Minimum absolute change in relative luminance (0..1) for a transition to count
   * as a flash-relevant luminance step. Smaller = more sensitive.
   */
  readonly lumaDeltaThreshold: number;
  /**
   * Flashes-per-second at or above which the trailing window is considered a
   * seizure risk. The WCAG/IEC general threshold is 3.
   */
  readonly flashesPerSecondLimit: number;
}

/** Built-in sensitivity profiles, selectable via config. */
export const SENSITIVITY_PROFILES: Record<string, SensitivityProfile> = {
  // WCAG / IEC general flash threshold: >3 flashes per second, ~10% luminance step.
  standard: { id: 'standard', lumaDeltaThreshold: 0.1, flashesPerSecondLimit: 3 },
  // More cautious: smaller steps count, trips one flash sooner.
  high: { id: 'high', lumaDeltaThreshold: 0.05, flashesPerSecondLimit: 2 },
  // More permissive: only large, fast flashing trips the guard.
  low: { id: 'low', lumaDeltaThreshold: 0.2, flashesPerSecondLimit: 4 },
};

/** Length of the trailing analysis window, in milliseconds. */
const WINDOW_MS = 1000;

/** The result of ingesting a single luminance sample. */
export interface FlashReading {
  /** Significant luminance reversals observed in the trailing 1s window. */
  flashesPerSecond: number;
  /** True when `flashesPerSecond` exceeds the profile limit. */
  risk: boolean;
}

/**
 * Sliding-window flash counter. Stateful across samples; one instance per enabled
 * service. Not safe for concurrent use (the service drives it from one place).
 */
export class FlashDetector {
  #profile: SensitivityProfile;
  /** Timestamps (ms) of recent opposing transitions, oldest-first (2 = one flash). */
  readonly #flashes: number[] = [];
  #flashHead = 0;
  /** Last luminance level at which a significant transition was registered. */
  #lastLevel?: number;
  /** Direction of the last significant transition: +1 (brighter) or -1 (darker). */
  #lastDir = 0;

  constructor(profile: SensitivityProfile = SENSITIVITY_PROFILES.standard) {
    this.#profile = profile;
  }

  get profile(): SensitivityProfile {
    return this.#profile;
  }

  /** Drop all accumulated state (e.g. when the guard is re-enabled). */
  reset(): void {
    this.#flashes.length = 0;
    this.#flashHead = 0;
    this.#lastLevel = undefined;
    this.#lastDir = 0;
  }

  /**
   * Feed one relative-luminance sample (clamped to 0..1) captured at `atMs`.
   * Returns the current trailing-window reading.
   */
  sample(luminance: number, atMs: number): FlashReading {
    const level = clamp01(luminance);

    if (this.#lastLevel === undefined) {
      this.#lastLevel = level;
      return this.#read(atMs);
    }

    const delta = level - this.#lastLevel;
    if (Math.abs(delta) >= this.#profile.lumaDeltaThreshold) {
      const dir = delta > 0 ? 1 : -1;
      // A flash is an *opposing* transition: a rise after a fall, or vice versa.
      if (this.#lastDir !== 0 && dir !== this.#lastDir) {
        this.#flashes.push(atMs);
      }
      this.#lastDir = dir;
      this.#lastLevel = level;
    }

    return this.#read(atMs);
  }

  /** Re-evaluate the trailing window at `atMs` without ingesting a sample. */
  readAt(atMs: number): FlashReading {
    return this.#read(atMs);
  }

  #read(atMs: number): FlashReading {
    const cutoff = atMs - WINDOW_MS;
    while (this.#flashHead < this.#flashes.length && this.#flashes[this.#flashHead] < cutoff) {
      this.#flashHead += 1;
    }
    if (this.#flashHead > 0 && this.#flashHead * 2 >= this.#flashes.length) {
      this.#flashes.splice(0, this.#flashHead);
      this.#flashHead = 0;
    }
    // A flash (per WCAG/IEC) is a *pair* of opposing luminance changes — one rise
    // and one fall — so two recorded reversals make one flash.
    const flashesPerSecond = (this.#flashes.length - this.#flashHead) / 2;
    return {
      flashesPerSecond,
      risk: flashesPerSecond > this.#profile.flashesPerSecondLimit,
    };
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
