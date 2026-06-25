/**
 * Strategy pattern: how a detected flash reading is translated into a protective
 * dim/filter intensity on the overlay surface.
 *
 * Each strategy is a pure function of the current {@link FlashReading} → an
 * intensity in 0..1 (0 = fully transparent, 1 = fully opaque dim). Swapping the
 * strategy changes how the guard *responds* without touching detection.
 */

import {
  SENSITIVITY_PROFILES,
  type FlashReading,
  type SensitivityProfile,
} from './detector.js';

/** A flash-response strategy. */
export interface FilterStrategy {
  readonly id: string;
  /** Map a reading to the dim-layer intensity (0..1) it should display. */
  intensity(reading: FlashReading): number;
}

/**
 * Ramp the dim proportionally to how far over the risk limit the flashing is, so
 * mild flashing barely dims and severe strobing dims hard. Clears to 0 when safe.
 */
export class AdaptiveDimStrategy implements FilterStrategy {
  readonly id = 'adaptive-dim';
  readonly #limit: number;
  readonly #maxIntensity: number;

  constructor(limit = 3, maxIntensity = 0.85) {
    this.#limit = Math.max(1, limit);
    this.#maxIntensity = clamp01(maxIntensity);
  }

  intensity(reading: FlashReading): number {
    if (!reading.risk) return 0;
    // Scale from the limit up to ~2x the limit, then cap.
    const over = reading.flashesPerSecond - this.#limit + 1;
    const scaled = over / this.#limit;
    return clamp01(Math.min(1, scaled)) * this.#maxIntensity;
  }
}

/** Fully clamp to a strong dim the instant flashing is risky; clear when safe. */
export class BlackoutStrategy implements FilterStrategy {
  readonly id = 'blackout';
  readonly #intensity: number;

  constructor(intensity = 0.9) {
    this.#intensity = clamp01(intensity);
  }

  intensity(reading: FlashReading): number {
    return reading.risk ? this.#intensity : 0;
  }
}

const STRATEGY_FACTORIES = {
  'adaptive-dim': (profile: SensitivityProfile) =>
    new AdaptiveDimStrategy(profile.flashesPerSecondLimit),
  blackout: (_profile: SensitivityProfile) => new BlackoutStrategy(),
} satisfies Record<string, (profile: SensitivityProfile) => FilterStrategy>;

export type StrategyId = keyof typeof STRATEGY_FACTORIES;

export const STRATEGIES: Record<StrategyId, FilterStrategy> = {
  'adaptive-dim': STRATEGY_FACTORIES['adaptive-dim'](SENSITIVITY_PROFILES.standard),
  blackout: STRATEGY_FACTORIES.blackout(SENSITIVITY_PROFILES.standard),
};

export function createStrategy(strategyId: StrategyId, profile: SensitivityProfile): FilterStrategy {
  return STRATEGY_FACTORIES[strategyId](profile);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
