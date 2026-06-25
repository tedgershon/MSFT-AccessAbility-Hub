/**
 * Unit tests for the colorblind / contrast overlay service.
 *
 * The service has no renderer handle, so it mounts/unmounts its correction layer
 * on the shared overlay surface by emitting `overlay/attach` / `overlay/detach`.
 * These tests drive the lifecycle with a {@link CapturingBus} and assert what the
 * service published.
 */

import { describe, expect, it } from 'vitest';
import {
  type ConfigStore,
  type EventPayload,
  type ServiceContext,
} from '@aah/contracts';
import { CapturingBus } from '@aah/test-fixtures';
import { ColorblindContrastService } from './service.js';

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
  const ctx: ServiceContext = { bus, config, selfId: 'colorblind-contrast' };
  return { ctx, bus };
}

const LAYER_ID = 'colorblind-contrast:correction';
type EmittedEvent = CapturingBus['emitted'][number];

/** All `overlay/attach` payloads the service published, in order. */
function attachEvents(bus: CapturingBus): Array<EventPayload<'overlay/attach'>> {
  return bus.emitted
    .filter((e: EmittedEvent) => e.topic === 'overlay/attach')
    .map((e: EmittedEvent) => e.payload as EventPayload<'overlay/attach'>);
}

/** All `overlay/detach` payloads the service published, in order. */
function detachEvents(bus: CapturingBus): Array<EventPayload<'overlay/detach'>> {
  return bus.emitted
    .filter((e: EmittedEvent) => e.topic === 'overlay/detach')
    .map((e: EmittedEvent) => e.payload as EventPayload<'overlay/detach'>);
}

describe('ColorblindContrastService', () => {
  it('declares only a shared displayOverlay capability', () => {
    const svc = new ColorblindContrastService();
    expect(svc.requires).toEqual([{ resource: 'displayOverlay', mode: 'shared' }]);
  });

  it('onEnable mounts a color-correction layer on the overlay surface', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new ColorblindContrastService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    const events = attachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      id: LAYER_ID,
      ownerId: 'colorblind-contrast',
      kind: 'color-correction',
      params: { strategy: 'deuteranopia' },
    });
  });

  it('onDisable detaches the layer it attached', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new ColorblindContrastService();
    await svc.onLoad(ctx);
    await svc.onEnable();
    await svc.onDisable();

    const events = detachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id: LAYER_ID, ownerId: 'colorblind-contrast' });
  });

  it('healthCheck reflects load + overlay state transitions', async () => {
    const { ctx } = makeCtx();
    const svc = new ColorblindContrastService();

    expect(svc.healthCheck().state).toBe('degraded');
    expect(svc.healthCheck().detail).toBe('not loaded');

    await svc.onLoad(ctx);
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onEnable();
    expect(svc.healthCheck().detail).toBe('overlay active (deuteranopia)');

    await svc.onDisable();
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onUnload();
    expect(svc.healthCheck().state).toBe('degraded');
  });

  it('selects the configured strategy and reflects it in the attached layer', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'colorblind.strategy': 'protanopia' }));
    const svc = new ColorblindContrastService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(attachEvents(bus)[0].params).toEqual({ strategy: 'protanopia' });
    expect(svc.healthCheck().detail).toBe('overlay active (protanopia)');
  });

  it('falls back to the default strategy when config is unknown', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'colorblind.strategy': 'nope' }));
    const svc = new ColorblindContrastService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(attachEvents(bus)[0].params).toEqual({ strategy: 'deuteranopia' });
  });

  it('does not touch the overlay surface before it is loaded', async () => {
    const svc = new ColorblindContrastService();
    // No onLoad → no ctx → enabling cannot emit (and must not throw).
    await expect(svc.onEnable()).resolves.toBeUndefined();
    await expect(svc.onDisable()).resolves.toBeUndefined();
    expect(svc.healthCheck().state).toBe('degraded');
  });
});
