/**
 * Unit tests for the Simplify Text service.
 *
 * The service has no renderer handle; it mounts/unmounts its transform layer on
 * the shared overlay surface by emitting `overlay/attach` / `overlay/detach`.
 * Tests drive the lifecycle with a {@link CapturingBus} and assert what was published.
 */

import { describe, expect, it } from 'vitest';
import {
  type ConfigStore,
  type EventPayload,
  type ServiceContext,
} from '@aah/contracts';
import { CapturingBus } from '@aah/test-fixtures';
import { SimplifyTextService } from './service.js';

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
  const ctx: ServiceContext = { bus, config, selfId: 'simplify-text' };
  return { ctx, bus };
}

const LAYER_ID = 'simplify-text:transform';

function attachEvents(bus: CapturingBus): Array<EventPayload<'overlay/attach'>> {
  return bus.emitted
    .filter((e) => e.topic === 'overlay/attach')
    .map((e) => e.payload as EventPayload<'overlay/attach'>);
}

function detachEvents(bus: CapturingBus): Array<EventPayload<'overlay/detach'>> {
  return bus.emitted
    .filter((e) => e.topic === 'overlay/detach')
    .map((e) => e.payload as EventPayload<'overlay/detach'>);
}

describe('SimplifyTextService', () => {
  it('declares only a shared displayOverlay capability', () => {
    const svc = new SimplifyTextService();
    expect(svc.requires).toEqual([{ resource: 'displayOverlay', mode: 'shared' }]);
  });

  it('onEnable mounts a text-simplification layer in simplify mode by default', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    const events = attachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      id: LAYER_ID,
      ownerId: 'simplify-text',
      kind: 'text-simplification',
      params: { mode: 'simplify' },
    });
  });

  it('onDisable detaches the layer it attached', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();
    await svc.onDisable();

    const events = detachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id: LAYER_ID, ownerId: 'simplify-text' });
  });

  it('healthCheck reflects load + overlay state transitions', async () => {
    const { ctx } = makeCtx();
    const svc = new SimplifyTextService();

    expect(svc.healthCheck().state).toBe('degraded');
    expect(svc.healthCheck().detail).toBe('not loaded');

    await svc.onLoad(ctx);
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onEnable();
    expect(svc.healthCheck().detail).toBe('overlay active (simplify)');

    await svc.onDisable();
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onUnload();
    expect(svc.healthCheck().state).toBe('degraded');
  });

  it('selects the restructure strategy when configured (NAPE/cognitive-style mode)', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'simplifyText.mode': 'restructure' }));
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(attachEvents(bus)[0].params).toEqual({ mode: 'restructure' });
    expect(svc.healthCheck().detail).toBe('overlay active (restructure)');
  });

  it('falls back to simplify when the configured mode is unrecognised', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'simplifyText.mode': 'unknown-mode' }));
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(attachEvents(bus)[0].params).toEqual({ mode: 'simplify' });
  });

  it('does not touch the overlay surface before it is loaded', async () => {
    const svc = new SimplifyTextService();
    await expect(svc.onEnable()).resolves.toBeUndefined();
    await expect(svc.onDisable()).resolves.toBeUndefined();
    expect(svc.healthCheck().state).toBe('degraded');
  });

  it('does not emit detach if disabled without a prior enable', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onDisable();

    expect(detachEvents(bus)).toHaveLength(0);
  });
});
