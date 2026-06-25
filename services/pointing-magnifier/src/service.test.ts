/**
 * Unit tests for the Pointing Magnifier overlay service.
 *
 * The service has no renderer handle, so it mounts/unmounts its magnifier layer on
 * the shared overlay surface by emitting `overlay/attach` / `overlay/update` /
 * `overlay/detach`. These tests drive the lifecycle with a {@link CapturingBus} and
 * assert what the service published, including how it reacts to a gaze-derived
 * `input/target-hint` from the eye-tracking service.
 */

import { describe, expect, it } from 'vitest';
import {
  type ConfigStore,
  type EventPayload,
  type ServiceContext,
} from '@aah/contracts';
import { CapturingBus } from '@aah/test-fixtures';
import { PointingMagnifierService } from './service.js';

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
  const ctx: ServiceContext = { bus, config, selfId: 'pointing-magnifier' };
  return { ctx, bus };
}

const LAYER_ID = 'pointing-magnifier:magnifier';

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

describe('PointingMagnifierService', () => {
  it('declares only a shared displayOverlay capability', () => {
    const svc = new PointingMagnifierService();
    expect(svc.requires).toEqual([{ resource: 'displayOverlay', mode: 'shared' }]);
  });

  it('onEnable mounts a pointer-magnifier layer with the default scale', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new PointingMagnifierService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    const events = attachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      id: LAYER_ID,
      ownerId: 'pointing-magnifier',
      kind: 'pointer-magnifier',
      params: { scale: 2, targetHint: null },
    });
  });

  it('onDisable detaches the layer it attached', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new PointingMagnifierService();
    await svc.onLoad(ctx);
    await svc.onEnable();
    await svc.onDisable();

    const events = detachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id: LAYER_ID, ownerId: 'pointing-magnifier' });
  });

  it('uses the configured scale', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'pointing-magnifier.scale': 4 }));
    const svc = new PointingMagnifierService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(attachEvents(bus)[0].params).toEqual({ scale: 4, targetHint: null });
  });

  it('re-emits overlay/update with the latest gaze target hint', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new PointingMagnifierService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    const hint: EventPayload<'input/target-hint'> = {
      source: 'eye-tracking',
      x: 120,
      y: 340,
      confidence: 0.8,
    };
    ctx.bus.emit('input/target-hint', hint);

    const updates = updateEvents(bus);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      id: LAYER_ID,
      ownerId: 'pointing-magnifier',
      kind: 'pointer-magnifier',
      params: { scale: 2, targetHint: hint },
    });
    expect(svc.healthCheck().detail).toBe('overlay active (scale=2, hinted)');
  });

  it('stops reacting to target hints after onDisable', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new PointingMagnifierService();
    await svc.onLoad(ctx);
    await svc.onEnable();
    await svc.onDisable();

    ctx.bus.emit('input/target-hint', {
      source: 'eye-tracking',
      x: 1,
      y: 1,
      confidence: 0.5,
    });

    expect(updateEvents(bus)).toHaveLength(0);
  });

  it('healthCheck reflects load + overlay state transitions', async () => {
    const { ctx } = makeCtx();
    const svc = new PointingMagnifierService();

    expect(svc.healthCheck().state).toBe('degraded');
    expect(svc.healthCheck().detail).toBe('not loaded');

    await svc.onLoad(ctx);
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onEnable();
    expect(svc.healthCheck().detail).toBe('overlay active (scale=2)');

    await svc.onDisable();
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onUnload();
    expect(svc.healthCheck().state).toBe('degraded');
  });

  it('does not touch the overlay surface before it is loaded', async () => {
    const svc = new PointingMagnifierService();
    await expect(svc.onEnable()).resolves.toBeUndefined();
    await expect(svc.onDisable()).resolves.toBeUndefined();
    expect(svc.healthCheck().state).toBe('degraded');
  });
});
