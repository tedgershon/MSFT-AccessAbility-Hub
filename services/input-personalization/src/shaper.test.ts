/**
 * Unit tests for the InputShaper engine.
 *
 * Time is injected (`atMs`) so the dwell / key-repeat / click-hold logic is fully
 * deterministic without timers. Durations come from the InputProfile.
 */

import { describe, expect, it } from 'vitest';
import type { InputProfile } from '@aah/contracts';
import { InputShaper } from './shaper.js';

const DEFAULT: InputProfile = {
  id: 'default',
  dwellMs: 0,
  clickHoldMs: 0,
  keyRepeatFilterMs: 0,
  angleGainFloor: 1,
  clickSlipMaxPx: 0,
  areaCursorRadiusPx: 0,
};
const TREMOR: InputProfile = {
  id: 'tremor',
  dwellMs: 400,
  clickHoldMs: 250,
  keyRepeatFilterMs: 120,
  angleGainFloor: 0.4,
  clickSlipMaxPx: 12,
  areaCursorRadiusPx: 18,
};

describe('InputShaper — default profile is a pass-through', () => {
  it('accepts every keydown', () => {
    const shaper = new InputShaper(DEFAULT);
    expect(shaper.filterKeydown('a', 0)).toBe(true);
    expect(shaper.filterKeydown('a', 1)).toBe(true);
  });

  it('never synthesizes a dwell-click', () => {
    const shaper = new InputShaper(DEFAULT);
    expect(shaper.observePointer({ x: 0, y: 0, atMs: 0 })).toBeNull();
    expect(shaper.observePointer({ x: 0, y: 0, atMs: 10_000 })).toBeNull();
  });

  it('accepts any click regardless of hold time', () => {
    const shaper = new InputShaper(DEFAULT);
    expect(shaper.observeButton('down', 0)).toBeNull();
    expect(shaper.observeButton('up', 1)).toBe(true);
  });
});

describe('InputShaper — key-repeat filter', () => {
  it('debounces repeats within the filter window but lets later presses through', () => {
    const shaper = new InputShaper(TREMOR);
    expect(shaper.filterKeydown('a', 0)).toBe(true); // first press accepted
    expect(shaper.filterKeydown('a', 50)).toBe(false); // bounce within 120ms
    expect(shaper.filterKeydown('a', 119)).toBe(false); // still within window
    expect(shaper.filterKeydown('a', 120)).toBe(true); // window elapsed
  });

  it('tracks each key independently', () => {
    const shaper = new InputShaper(TREMOR);
    expect(shaper.filterKeydown('a', 0)).toBe(true);
    expect(shaper.filterKeydown('b', 10)).toBe(true); // different key, not debounced
    expect(shaper.filterKeydown('a', 10)).toBe(false);
  });
});

describe('InputShaper — dwell-click (gaze/pointer selection)', () => {
  it('fires once after the pointer rests for dwellMs, then stays quiet', () => {
    const shaper = new InputShaper(TREMOR);
    expect(shaper.observePointer({ x: 100, y: 100, atMs: 0 })).toBeNull(); // anchor
    expect(shaper.observePointer({ x: 105, y: 102, atMs: 200 })).toBeNull(); // still dwelling
    const click = shaper.observePointer({ x: 103, y: 101, atMs: 400 });
    expect(click).toEqual({ x: 103, y: 101, atMs: 400 });
    // Does not re-fire while the pointer keeps resting.
    expect(shaper.observePointer({ x: 103, y: 101, atMs: 600 })).toBeNull();
  });

  it('re-arms when the pointer leaves the dwell radius', () => {
    const shaper = new InputShaper(TREMOR, { dwellRadiusPx: 10 });
    expect(shaper.observePointer({ x: 0, y: 0, atMs: 0 })).toBeNull();
    // Jump well outside the 10px radius — this re-anchors, no click yet.
    expect(shaper.observePointer({ x: 500, y: 500, atMs: 500 })).toBeNull();
    // Now dwell at the new spot for the full window.
    const click = shaper.observePointer({ x: 500, y: 500, atMs: 900 });
    expect(click).toEqual({ x: 500, y: 500, atMs: 900 });
  });
});

describe('InputShaper — click-hold debounce', () => {
  it('rejects a tap released before clickHoldMs', () => {
    const shaper = new InputShaper(TREMOR);
    expect(shaper.observeButton('down', 0)).toBeNull();
    expect(shaper.observeButton('up', 100)).toBe(false); // < 250ms
  });

  it('accepts a press held for at least clickHoldMs', () => {
    const shaper = new InputShaper(TREMOR);
    expect(shaper.observeButton('down', 0)).toBeNull();
    expect(shaper.observeButton('up', 250)).toBe(true);
  });

  it('rejects an up with no matching down', () => {
    const shaper = new InputShaper(TREMOR);
    expect(shaper.observeButton('up', 0)).toBe(false);
  });
});

describe('InputShaper — reset', () => {
  it('clears key history, dwell anchor, and pending press', () => {
    const shaper = new InputShaper(TREMOR);
    shaper.filterKeydown('a', 0);
    shaper.observePointer({ x: 0, y: 0, atMs: 0 });
    shaper.observeButton('down', 0);

    shaper.reset();

    expect(shaper.filterKeydown('a', 10)).toBe(true); // history cleared
    expect(shaper.observeButton('up', 10)).toBe(false); // pending press cleared
  });
});

describe('InputShaper — Angle Mouse dynamic gain', () => {
  it('returns gain 1 for the default profile (disabled floor)', () => {
    const shaper = new InputShaper(DEFAULT);
    for (let x = 0; x <= 50; x += 10) {
      expect(shaper.observeMovement({ x, y: 0, atMs: x })).toBe(1);
    }
  });

  it('keeps gain at 1 for perfectly straight (ballistic) motion', () => {
    const shaper = new InputShaper(TREMOR);
    let gain = 1;
    for (let x = 0; x <= 60; x += 10) {
      gain = shaper.observeMovement({ x, y: 0, atMs: x });
    }
    expect(gain).toBeCloseTo(1, 5); // zero angular deviation → no slowdown
  });

  it('reduces gain toward the floor for erratic, reversing motion', () => {
    const shaper = new InputShaper(TREMOR);
    // Back-and-forth jitter: every step reverses direction (180° turns).
    const xs = [0, 10, 2, 12, 3, 13, 4];
    let gain = 1;
    xs.forEach((x, i) => {
      gain = shaper.observeMovement({ x, y: 0, atMs: i * 10 });
    });
    expect(gain).toBeLessThan(0.6); // clearly slowed
    expect(gain).toBeGreaterThanOrEqual(TREMOR.angleGainFloor); // never below floor
  });

  it('does not slow down before enough motion history exists', () => {
    const shaper = new InputShaper(TREMOR);
    expect(shaper.observeMovement({ x: 0, y: 0, atMs: 0 })).toBe(1);
    expect(shaper.observeMovement({ x: 5, y: 0, atMs: 10 })).toBe(1);
  });
});

describe('InputShaper — Steady Clicks (freeze + slip rejection)', () => {
  it('freezes the click at the down point and accepts a steady press', () => {
    const shaper = new InputShaper(TREMOR);
    shaper.pressDown({ x: 100, y: 100, atMs: 0 });
    shaper.pressMove({ x: 104, y: 102, atMs: 150 }); // small slip, within 12px
    const click = shaper.pressUp({ x: 103, y: 101, atMs: 300 }); // held >= 250ms

    expect(click).toEqual({ accepted: true, x: 100, y: 100, slipPx: expect.any(Number) });
    expect(click?.x).toBe(100); // reported where the press BEGAN, not ended
  });

  it('rejects a click that slips beyond the tolerance', () => {
    const shaper = new InputShaper(TREMOR);
    shaper.pressDown({ x: 100, y: 100, atMs: 0 });
    shaper.pressMove({ x: 100, y: 140, atMs: 150 }); // 40px slip > 12px tolerance
    const click = shaper.pressUp({ x: 100, y: 138, atMs: 300 });

    expect(click?.accepted).toBe(false);
    expect(click?.slipPx).toBeGreaterThan(TREMOR.clickSlipMaxPx);
  });

  it('rejects a press released before the hold time', () => {
    const shaper = new InputShaper(TREMOR);
    shaper.pressDown({ x: 0, y: 0, atMs: 0 });
    const click = shaper.pressUp({ x: 0, y: 0, atMs: 100 }); // < 250ms
    expect(click?.accepted).toBe(false);
  });

  it('default profile ignores slip and hold (pass-through), still freezes point', () => {
    const shaper = new InputShaper(DEFAULT);
    shaper.pressDown({ x: 50, y: 60, atMs: 0 });
    shaper.pressMove({ x: 400, y: 600, atMs: 5 }); // huge slip, but tolerance disabled
    const click = shaper.pressUp({ x: 420, y: 620, atMs: 10 });

    expect(click).toEqual({ accepted: true, x: 50, y: 60, slipPx: expect.any(Number) });
  });

  it('returns null on an up with no matching down', () => {
    const shaper = new InputShaper(TREMOR);
    expect(shaper.pressUp({ x: 0, y: 0, atMs: 0 })).toBeNull();
  });
});
