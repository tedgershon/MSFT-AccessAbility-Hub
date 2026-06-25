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

/** Default radius (px) the gaze/pointer may wander and still count as dwelling. */
export const DEFAULT_DWELL_RADIUS_PX = 24;

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
   * Feed a pointer-button transition. On `'down'` returns `null` (press is pending).
   * On `'up'` returns whether the press counts as a deliberate click: `true` if it
   * was held at least `clickHoldMs`, `false` if released too quickly (an accidental
   * tap) or seen without a matching press. `clickHoldMs <= 0` accepts every click.
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

  /** Clear all transient state (key history, dwell anchor, pending press). */
  reset(): void {
    this.#lastKeydownAtMs.clear();
    this.#dwellAnchor = null;
    this.#dwellFired = false;
    this.#pressDownAtMs = null;
  }

  #within(a: PointerSample, b: PointerSample): boolean {
    return Math.hypot(a.x - b.x, a.y - b.y) <= this.#dwellRadiusPx;
  }
}
