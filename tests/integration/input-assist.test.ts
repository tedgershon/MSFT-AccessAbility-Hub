/**
 * Integration: the motor & dexterity "Input Assist" tile (issue #31) driven by a
 * gaze stream from eye-tracking.
 *
 * This stitches the two child services together over a shared bus the way the hub
 * would once the Python eye-tracking service is bridged in:
 *
 *   camera → eye-tracking → `input/target-hint` (gaze, screen coords)
 *     ├─ pointing-magnifier (#22) follows the hint (magnification / target-assist)
 *     └─ input-personalization (#25) dwell timer turns a stable hint into a click
 *
 * Dwell-on-gaze is the selection method dedicated eye trackers and webcam gaze share
 * (cf. Microsoft Eye Control; Chhimpa et al. 2023). Here the gaze stream is
 * simulated so the flow is hardware-free and deterministic.
 */

import { describe, expect, it } from 'vitest';
import type { ConfigStore, EventPayload, ServiceContext } from '../../core/contracts/src/index.js';
import { InMemoryEventBus } from '../../core/kernel/src/event-bus.js';
import { PointingMagnifierService } from '../../services/pointing-magnifier/src/service.js';
import { InputShaper } from '../../services/input-personalization/src/shaper.js';

const TREMOR = {
  id: 'tremor',
  dwellMs: 400,
  clickHoldMs: 250,
  keyRepeatFilterMs: 120,
  angleGainFloor: 0.4,
  clickSlipMaxPx: 12,
  areaCursorRadiusPx: 18,
};

function fakeConfig(initial: Record<string, unknown> = {}): ConfigStore {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get<T = unknown>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    set<T = unknown>(key: string, value: T): void {
      store.set(key, value);
    },
  };
}

describe('Integration: Input Assist tile follows gaze and dwell-selects', () => {
  it('routes a gaze hint stream to magnifier-follow and dwell-click', async () => {
    const bus = new InMemoryEventBus();
    const updates: Array<EventPayload<'overlay/update'>> = [];
    bus.on('overlay/update', (layer) => updates.push(layer));

    const magnifier = new PointingMagnifierService();
    const ctx: ServiceContext = { bus, config: fakeConfig(), selfId: 'pointing-magnifier' };
    await magnifier.onLoad(ctx);
    await magnifier.onEnable();

    // The user's dwell profile lives in input-personalization; its shaper applies it.
    const shaper = new InputShaper(TREMOR);

    // Eye-tracking emits a near-stationary gaze point over ~400ms (as if bridged
    // from the Python service over the kernel bus).
    const gazeStream = [
      { x: 800, y: 450, atMs: 0 },
      { x: 805, y: 452, atMs: 200 },
      { x: 803, y: 449, atMs: 400 },
    ];

    let dwellClick: { x: number; y: number; atMs: number } | null = null;
    for (const point of gazeStream) {
      bus.emit('input/target-hint', {
        source: 'eye-tracking',
        x: point.x,
        y: point.y,
        confidence: 0.9,
      });
      const click = shaper.observePointer(point);
      if (click) dwellClick = click;
    }

    // (1) The magnifier followed gaze: its latest overlay/update carries the newest
    // hint, so the magnified region tracks where the user is looking.
    expect(updates).toHaveLength(gazeStream.length);
    expect(updates.at(-1)?.params?.targetHint).toEqual({
      source: 'eye-tracking',
      x: 803,
      y: 449,
      confidence: 0.9,
    });

    // (2) Dwelling on the gaze point produced exactly one selection at that point.
    expect(dwellClick).toEqual({ x: 803, y: 449, atMs: 400 });
  });

  it('re-targets the magnifier and re-arms dwell when gaze jumps away', async () => {
    const bus = new InMemoryEventBus();
    const updates: Array<EventPayload<'overlay/update'>> = [];
    bus.on('overlay/update', (layer) => updates.push(layer));

    const magnifier = new PointingMagnifierService();
    await magnifier.onLoad({ bus, config: fakeConfig(), selfId: 'pointing-magnifier' });
    await magnifier.onEnable();

    const shaper = new InputShaper(TREMOR, { dwellRadiusPx: 20 });

    // Look at A briefly, then jump to B before A's dwell completes.
    const stream = [
      { x: 100, y: 100, atMs: 0 }, // anchor A
      { x: 900, y: 700, atMs: 200 }, // jump to B → re-anchor, no click
      { x: 902, y: 698, atMs: 600 }, // dwell at B completes (>=400ms)
    ];

    const clicks: Array<{ x: number; y: number; atMs: number }> = [];
    for (const point of stream) {
      bus.emit('input/target-hint', { source: 'eye-tracking', ...point, confidence: 0.85 });
      const click = shaper.observePointer(point);
      if (click) clicks.push(click);
    }

    // Exactly one click, and it landed at B (not the abandoned A).
    expect(clicks).toEqual([{ x: 902, y: 698, atMs: 600 }]);
    expect(updates.at(-1)?.params?.targetHint).toMatchObject({ x: 902, y: 698 });
  });
});
