/**
 * Input shaping engine (issue #25).
 *
 * Pure, deterministic remapping of raw input into deliberate actions, driven by an
 * {@link InputProfile}. It holds no OS handles and emits no events — it is a
 * decision library a capture adapter (or the input-injection multiplexer) feeds
 * timestamped raw input into, applying the user's motor-accessibility profile:
 *
 * - **key-repeat filter** — debounce repeated `keydown`s for the same key.
 * - **dwell-click** — synthesize a click when the pointer rests on a spot.
 * - **click-hold** — require a press to be held before it counts as a click,
 *   rejecting accidental taps/tremor.
 *
 * Every duration comes from the profile in milliseconds; `0` disables that stage so
 * the `default` profile is a pass-through. Time is passed in explicitly (`atMs`) so
 * the engine is fully testable without timers or a clock.
 */

import type { InputProfile } from '@aah/contracts';

/** A pointer position sampled at a moment in time. */
export interface PointerSample {
  x: number;
  y: number;
  atMs: number;
}

/** Screen point + time at which a dwell-click should be synthesized. */
export interface DwellClick {
  x: number;
  y: number;
  atMs: number;
}

/** Outcome of a Steady-Clicks press cycle (Trewin et al. 2006). */
export interface SteadyClick {
  /** Accepted only if held >= `clickHoldMs` AND slip stayed within tolerance. */
  accepted: boolean;
  /** Frozen click point — where the press *began* (Steady Clicks freeze). */
  x: number;
  y: number;
  /** Largest distance (px) the pointer drifted from the down point during the press. */
  slipPx: number;
}

/** Default radius (px) the gaze/pointer may wander and still count as dwelling. */
export const DEFAULT_DWELL_RADIUS_PX = 24;

/** How many recent samples the Angle Mouse gain estimator averages over. */
const ANGLE_WINDOW = 6;
/** Movements shorter than this (px) are treated as noise and ignored for gain. */
const ANGLE_MIN_STEP_PX = 1;

export interface InputShaperOptions {
  /** How far the pointer may drift from the dwell anchor and still dwell. */
  dwellRadiusPx?: number;
}

export class InputShaper {
  readonly #profile: InputProfile;
  readonly #dwellRadiusPx: number;

  readonly #lastKeydownAtMs = new Map<string, number>();
  #dwellAnchor: PointerSample | null = null;
  #dwellFired = false;
  #pressDownAtMs: number | null = null;

  // Angle Mouse gain state: a short trail of recent pointer samples.
  readonly #trail: PointerSample[] = [];
  // Steady Clicks state: anchor of the in-progress press and its peak slip.
  #pressAnchor: PointerSample | null = null;
  #pressSlipPx = 0;

  constructor(profile: InputProfile, options: InputShaperOptions = {}) {
    this.#profile = profile;
    this.#dwellRadiusPx = options.dwellRadiusPx ?? DEFAULT_DWELL_RADIUS_PX;
  }

  /** The profile this shaper applies. */
  get profile(): InputProfile {
    return this.#profile;
  }

  /**
   * Decide whether a `keydown` should pass. Returns `false` for a repeat that
   * arrives within `keyRepeatFilterMs` of the last *accepted* press of that key, so
   * a held/bouncing key is debounced to at most one event per window. Suppressed
   * repeats deliberately do not advance the window, so a continuous fast burst still
   * yields periodic accepted presses rather than being silenced forever.
   */
  filterKeydown(key: string, atMs: number): boolean {
    const filterMs = this.#profile.keyRepeatFilterMs;
    if (filterMs <= 0) return true;
    const last = this.#lastKeydownAtMs.get(key);
    if (last !== undefined && atMs - last < filterMs) return false;
    this.#lastKeydownAtMs.set(key, atMs);
    return true;
  }

  /**
   * Feed a pointer sample. Returns a {@link DwellClick} exactly once when the
   * pointer has stayed within `dwellRadiusPx` of its anchor for `dwellMs`; returns
   * `null` otherwise. Moving outside the radius re-arms dwell at the new spot.
   * `dwellMs <= 0` disables dwell entirely.
   */
  observePointer(sample: PointerSample): DwellClick | null {
    const dwellMs = this.#profile.dwellMs;
    if (dwellMs <= 0) return null;

    if (this.#dwellAnchor === null || !this.#within(sample, this.#dwellAnchor)) {
      this.#dwellAnchor = sample;
      this.#dwellFired = false;
      return null;
    }

    if (!this.#dwellFired && sample.atMs - this.#dwellAnchor.atMs >= dwellMs) {
      this.#dwellFired = true;
      return { x: sample.x, y: sample.y, atMs: sample.atMs };
    }
    return null;
  }

  /**
   * Angle Mouse dynamic gain (Wobbrock et al. 2009). Feed successive pointer
   * samples; returns a gain multiplier in `[angleGainFloor, 1]` a downstream
   * consumer applies to pointer motion. Straight (ballistic) motion → gain near `1`;
   * erratic motion with large angular deviation (tremor, corrective sub-movements) →
   * gain toward the floor, so the pointer slows for easier final targeting. Returns
   * `1` when dynamic gain is disabled (`angleGainFloor >= 1`) or there is too little
   * motion history to judge. Target-agnostic: it never needs to know the target.
   */
  observeMovement(sample: PointerSample): number {
    const floor = this.#profile.angleGainFloor;
    this.#trail.push(sample);
    if (this.#trail.length > ANGLE_WINDOW) this.#trail.shift();
    if (floor >= 1) return 1;

    const deviation = this.#meanAngularDeviation();
    if (deviation === null) return 1;
    // deviation is in [0, PI]; straightness in [0, 1].
    const straightness = 1 - deviation / Math.PI;
    return floor + (1 - floor) * straightness;
  }

  /**
   * Feed a pointer-button transition. On `'down'` returns `null` (press is pending).
   * On `'up'` returns whether the press counts as a deliberate click: `true` if it
   * was held at least `clickHoldMs`, `false` if released too quickly (an accidental
   * tap) or seen without a matching press. `clickHoldMs <= 0` accepts every click.
   *
   * This is the time-only path; for Steady-Clicks slip rejection and click-position
   * freeze, use {@link pressDown}/{@link pressMove}/{@link pressUp} instead.
   */
  observeButton(type: 'down' | 'up', atMs: number): boolean | null {
    if (type === 'down') {
      this.#pressDownAtMs = atMs;
      return null;
    }
    const downAt = this.#pressDownAtMs;
    this.#pressDownAtMs = null;
    if (downAt === null) return false;
    const holdMs = this.#profile.clickHoldMs;
    if (holdMs <= 0) return true;
    return atMs - downAt >= holdMs;
  }

  /**
   * Steady Clicks (Trewin et al. 2006): begin a press, anchoring the click point so
   * the eventual click is reported where the press *started*, not where it ended.
   */
  pressDown(sample: PointerSample): void {
    this.#pressAnchor = sample;
    this.#pressSlipPx = 0;
  }

  /** Track how far the pointer has slipped from the press anchor mid-click. */
  pressMove(sample: PointerSample): void {
    const anchor = this.#pressAnchor;
    if (anchor === null) return;
    const slip = Math.hypot(sample.x - anchor.x, sample.y - anchor.y);
    if (slip > this.#pressSlipPx) this.#pressSlipPx = slip;
  }

  /**
   * Finish a press. Returns a {@link SteadyClick} reporting the frozen click point
   * (the down position) and whether it is accepted: it must be held at least
   * `clickHoldMs` and must not have slipped more than `clickSlipMaxPx`
   * (`<= 0` disables slip rejection). Returns `null` if there was no matching press.
   */
  pressUp(sample: PointerSample): SteadyClick | null {
    const anchor = this.#pressAnchor;
    this.#pressAnchor = null;
    if (anchor === null) return null;

    this.pressMove(sample);
    const slipPx = this.#pressSlipPx;
    const heldLongEnough =
      this.#profile.clickHoldMs <= 0 || sample.atMs - anchor.atMs >= this.#profile.clickHoldMs;
    const slipMax = this.#profile.clickSlipMaxPx;
    const withinSlip = slipMax <= 0 || slipPx <= slipMax;
    return { accepted: heldLongEnough && withinSlip, x: anchor.x, y: anchor.y, slipPx };
  }

  /** Clear all transient state (key history, dwell anchor, pending presses, trail). */
  reset(): void {
    this.#lastKeydownAtMs.clear();
    this.#dwellAnchor = null;
    this.#dwellFired = false;
    this.#pressDownAtMs = null;
    this.#trail.length = 0;
    this.#pressAnchor = null;
    this.#pressSlipPx = 0;
  }

  /**
   * Mean turn angle (radians, in `[0, PI]`) between consecutive movement vectors in
   * the trail, or `null` if there are not enough non-trivial movements to judge.
   */
  #meanAngularDeviation(): number | null {
    const steps: Array<{ dx: number; dy: number }> = [];
    for (let i = 1; i < this.#trail.length; i++) {
      const dx = this.#trail[i].x - this.#trail[i - 1].x;
      const dy = this.#trail[i].y - this.#trail[i - 1].y;
      if (Math.hypot(dx, dy) >= ANGLE_MIN_STEP_PX) steps.push({ dx, dy });
    }
    if (steps.length < 2) return null;

    let total = 0;
    let count = 0;
    for (let i = 1; i < steps.length; i++) {
      const a = steps[i - 1];
      const b = steps[i];
      const dot = a.dx * b.dx + a.dy * b.dy;
      const magA = Math.hypot(a.dx, a.dy);
      const magB = Math.hypot(b.dx, b.dy);
      if (magA === 0 || magB === 0) continue;
      const cos = Math.min(1, Math.max(-1, dot / (magA * magB)));
      total += Math.acos(cos);
      count += 1;
    }
    return count === 0 ? null : total / count;
  }

  #within(a: PointerSample, b: PointerSample): boolean {
    return Math.hypot(a.x - b.x, a.y - b.y) <= this.#dwellRadiusPx;
  }
}
