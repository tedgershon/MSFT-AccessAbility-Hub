/**
 * Unit tests for the colorblind / contrast overlay service.
 *
 * The service has no renderer handle, so it surfaces overlay attach/detach over
 * the bus seam (`service/health`). These tests drive the lifecycle with a
 * {@link CapturingBus} and assert what the service published.
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

/** All `service/health` payloads the service published, in order. */
function healthEvents(bus: CapturingBus): Array<EventPayload<'service/health'>> {
  return bus.emitted
    .filter((e) => e.topic === 'service/health')
    .map((e) => e.payload as EventPayload<'service/health'>);
}

describe('ColorblindContrastService', () => {
  it('declares only a shared displayOverlay capability', () => {
    const svc = new ColorblindContrastService();
    expect(svc.requires).toEqual([{ resource: 'displayOverlay', mode: 'shared' }]);
  });

  it('onEnable attaches the overlay via a service/health event with the active strategy', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new ColorblindContrastService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    const events = healthEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0].serviceId).toBe('colorblind-contrast');
    expect(events[0].status.state).toBe('healthy');
    expect(events[0].status.detail).toBe('overlay active (deuteranopia)');
  });

  it('onDisable detaches the overlay via a service/health event reporting idle', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new ColorblindContrastService();
    await svc.onLoad(ctx);
    await svc.onEnable();
    await svc.onDisable();

    const events = healthEvents(bus);
    expect(events).toHaveLength(2);
    expect(events[1].status.state).toBe('healthy');
    expect(events[1].status.detail).toBe('idle');
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

  it('selects the configured strategy and reflects it in the emitted payload', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'colorblind.strategy': 'protanopia' }));
    const svc = new ColorblindContrastService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(healthEvents(bus)[0].status.detail).toBe('overlay active (protanopia)');
    expect(svc.healthCheck().detail).toBe('overlay active (protanopia)');
  });

  it('falls back to the default strategy when config is unknown', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'colorblind.strategy': 'nope' }));
    const svc = new ColorblindContrastService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(healthEvents(bus)[0].status.detail).toBe('overlay active (deuteranopia)');
  });

  it('does not publish overlay state before it is loaded', async () => {
    const svc = new ColorblindContrastService();
    // No onLoad → no ctx → enabling cannot publish (and must not throw).
    await svc.onEnable();
    await svc.onDisable();
    // Nothing to assert on the bus; the guard simply prevents a crash.
    expect(svc.healthCheck().state).toBe('degraded');
  });
});
