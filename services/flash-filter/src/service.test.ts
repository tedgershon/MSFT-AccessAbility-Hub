/**
 * Unit tests for the Flash Filter (photosensitive-epilepsy) overlay service.
 *
 * The service has no renderer handle, so it mounts/updates/unmounts its protective
 * dim layer on the shared overlay surface by emitting `overlay/attach`,
 * `overlay/update`, and `overlay/detach`. These tests drive the lifecycle with a
 * {@link CapturingBus} and feed luminance samples to assert detection + filtering.
 */

import { describe, expect, it } from 'vitest';
import {
  type ConfigStore,
  type EventPayload,
  type ServiceContext,
} from '@aah/contracts';
import { CapturingBus } from '@aah/test-fixtures';
import { FlashFilterService } from './service.js';

/** Minimal in-memory config view for tests. */
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

function makeCtx(
  config: ConfigStore = fakeConfig(),
): { ctx: ServiceContext; bus: CapturingBus } {
  const bus = new CapturingBus();
  const ctx: ServiceContext = { bus, config, selfId: 'flash-filter' };
  return { ctx, bus };
}

const LAYER_ID = 'flash-filter:guard';

function attachEvents(bus: CapturingBus): Array<EventPayload<'overlay/attach'>> {
  return bus.emitted
    .filter((e) => e.topic === 'overlay/attach')
    .map((e) => e.payload as EventPayload<'overlay/attach'>);
}

function updateEvents(bus: CapturingBus): Array<EventPayload<'overlay/update'>> {
  return bus.emitted
    .filter((e) => e.topic === 'overlay/update')
    .map((e) => e.payload as EventPayload<'overlay/update'>);
}

function detachEvents(bus: CapturingBus): Array<EventPayload<'overlay/detach'>> {
  return bus.emitted
    .filter((e) => e.topic === 'overlay/detach')
    .map((e) => e.payload as EventPayload<'overlay/detach'>);
}

/**
 * Drive a square-wave strobe: alternate dark/bright at `hz` flashes per second,
 * starting at `startMs`, for `seconds`. Returns the last reading.
 */
function strobe(
  svc: FlashFilterService,
  hz: number,
  seconds: number,
  startMs = 0,
): { flashesPerSecond: number; risk: boolean } {
  const stepMs = 1000 / hz / 2; // half-period per level transition
  const steps = Math.round((seconds * 1000) / stepMs);
  let reading = { flashesPerSecond: 0, risk: false };
  for (let i = 0; i < steps; i++) {
    const luminance = i % 2 === 0 ? 0 : 1;
    reading = svc.ingestLuminance(luminance, startMs + i * stepMs);
  }
  return reading;
}

describe('FlashFilterService', () => {
  it('declares only a shared displayOverlay capability', () => {
    const svc = new FlashFilterService();
    expect(svc.requires).toEqual([{ resource: 'displayOverlay', mode: 'shared' }]);
  });

  it('onEnable mounts a transparent flash-guard layer on the overlay surface', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new FlashFilterService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    const events = attachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(LAYER_ID);
    expect(events[0].ownerId).toBe('flash-filter');
    expect(events[0].kind).toBe('flash-guard');
    expect(events[0].params).toMatchObject({
      intensity: 0,
      strategy: 'adaptive-dim',
      sensitivity: 'standard',
    });
  });

  it('onDisable detaches the layer it attached', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new FlashFilterService();
    await svc.onLoad(ctx);
    await svc.onEnable();
    await svc.onDisable();

    const events = detachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id: LAYER_ID, ownerId: 'flash-filter' });
  });

  it('raises the dim filter when flashing exceeds the safe threshold', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new FlashFilterService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    // 10 flashes/s of full-range strobing is well over the 3/s limit.
    const reading = strobe(svc, 10, 1);
    expect(reading.risk).toBe(true);
    expect(reading.flashesPerSecond).toBeGreaterThanOrEqual(3);

    const updates = updateEvents(bus);
    expect(updates.length).toBeGreaterThan(0);
    const last = updates[updates.length - 1].params as { intensity: number };
    expect(last.intensity).toBeGreaterThan(0);
  });

  it('keeps the filter transparent for slow, sub-threshold flashing', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new FlashFilterService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    // 2 flashes/s is below the standard 3/s limit → no risk, no dim.
    const reading = strobe(svc, 2, 2);
    expect(reading.risk).toBe(false);
    expect(updateEvents(bus)).toHaveLength(0);
  });

  it('does not emit or detect before being enabled', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new FlashFilterService();
    await svc.onLoad(ctx);

    const reading = svc.ingestLuminance(1, 0);
    expect(reading).toEqual({ flashesPerSecond: 0, risk: false });
    expect(updateEvents(bus)).toHaveLength(0);
    expect(attachEvents(bus)).toHaveLength(0);
  });

  it('healthCheck reflects load + monitoring + guarding transitions', async () => {
    const { ctx } = makeCtx();
    const svc = new FlashFilterService();

    expect(svc.healthCheck().state).toBe('degraded');
    expect(svc.healthCheck().detail).toBe('not loaded');

    await svc.onLoad(ctx);
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onEnable();
    expect(svc.healthCheck().detail).toBe('monitoring (standard)');

    strobe(svc, 10, 1);
    expect(svc.healthCheck().state).toBe('healthy');
    expect(svc.healthCheck().detail).toContain('guarding');

    await svc.onDisable();
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onUnload();
    expect(svc.healthCheck().state).toBe('degraded');
  });

  it('honours the configured sensitivity profile and filter strategy', async () => {
    const { ctx, bus } = makeCtx(
      fakeConfig({
        'flashFilter.sensitivity': 'high',
        'flashFilter.strategy': 'blackout',
      }),
    );
    const svc = new FlashFilterService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(attachEvents(bus)[0].params).toMatchObject({
      strategy: 'blackout',
      sensitivity: 'high',
    });

    // Blackout clamps to a strong, fixed dim once risk trips.
    strobe(svc, 10, 1);
    const updates = updateEvents(bus);
    const last = updates[updates.length - 1].params as { intensity: number };
    expect(last.intensity).toBeCloseTo(0.9, 2);
  });

  it('falls back to defaults when config values are unknown', async () => {
    const { ctx, bus } = makeCtx(
      fakeConfig({
        'flashFilter.sensitivity': 'nope',
        'flashFilter.strategy': 'nope',
      }),
    );
    const svc = new FlashFilterService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(attachEvents(bus)[0].params).toMatchObject({
      strategy: 'adaptive-dim',
      sensitivity: 'standard',
    });
  });

  it('clears the dim once flashing stops', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new FlashFilterService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    strobe(svc, 10, 1, 0);
    // Let the 1s window roll past the strobe with steady luminance.
    let cleared = svc.ingestLuminance(0.5, 3000);
    cleared = svc.ingestLuminance(0.5, 4000);
    expect(cleared.risk).toBe(false);

    const updates = updateEvents(bus);
    const last = updates[updates.length - 1].params as { intensity: number };
    expect(last.intensity).toBe(0);
  });

  it('does not touch the overlay surface before it is loaded', async () => {
    const svc = new FlashFilterService();
    await expect(svc.onEnable()).resolves.toBeUndefined();
    await expect(svc.onDisable()).resolves.toBeUndefined();
    expect(svc.healthCheck().state).toBe('degraded');
  });
});
