/**
 * Unit tests for the Simplify Text service.
 *
 * The service shows an overlay panel on top of the original text rather than
 * replacing it in-place. On the first `simplifyText/request` it attaches the panel
 * (`overlay/attach`); subsequent requests update it without re-attaching
 * (`overlay/update`). Disabling the service detaches the panel.
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

const LAYER_ID = 'simplify-text:panel';

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

describe('SimplifyTextService', () => {
  it('declares displayOverlay:shared — panel coexists with other overlay tiles', () => {
    const svc = new SimplifyTextService();
    expect(svc.requires).toEqual([{ resource: 'displayOverlay', mode: 'shared' }]);
  });

  it('attaches the panel on the first simplifyText/request', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    bus.emit('simplifyText/request', { text: 'Complex medical text.' });

    const events = attachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      id: LAYER_ID,
      ownerId: 'simplify-text',
      kind: 'text-simplification',
      params: { mode: 'simplify', original: 'Complex medical text.', simplified: 'Complex medical text.' },
    });
  });

  it('updates the existing panel on subsequent requests — does not re-attach', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    bus.emit('simplifyText/request', { text: 'First text.' });
    bus.emit('simplifyText/request', { text: 'Second text.' });

    expect(attachEvents(bus)).toHaveLength(1);
    const updates = updateEvents(bus);
    expect(updates).toHaveLength(1);
    expect(updates[0].params?.original).toBe('Second text.');
  });

  it('detaches the panel on onDisable', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    bus.emit('simplifyText/request', { text: 'Some text.' });
    await svc.onDisable();

    const events = detachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id: LAYER_ID, ownerId: 'simplify-text' });
  });

  it('does not detach if no request was made before disabling', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();
    await svc.onDisable();

    expect(detachEvents(bus)).toHaveLength(0);
  });

  it('stops handling requests after onDisable', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();
    await svc.onDisable();

    bus.emit('simplifyText/request', { text: 'Should be ignored.' });

    expect(attachEvents(bus)).toHaveLength(0);
  });

  it('uses RestructureStrategy when configured (NAPE cognitive-style mode)', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'simplifyText.mode': 'restructure' }));
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    bus.emit('simplifyText/request', { text: 'Learning material.' });

    expect(attachEvents(bus)[0].params?.mode).toBe('restructure');
    expect(svc.healthCheck().detail).toBe('panel active (restructure)');
  });

  it('falls back to simplify when configured mode is unrecognised', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'simplifyText.mode': 'unknown' }));
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    bus.emit('simplifyText/request', { text: 'text' });

    expect(attachEvents(bus)[0].params?.mode).toBe('simplify');
  });

  it('healthCheck reflects full lifecycle transitions', async () => {
    const { ctx } = makeCtx();
    const svc = new SimplifyTextService();

    expect(svc.healthCheck().state).toBe('degraded');
    expect(svc.healthCheck().detail).toBe('not loaded');

    await svc.onLoad(ctx);
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onEnable();
    expect(svc.healthCheck().detail).toBe('panel active (simplify)');

    await svc.onDisable();
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onUnload();
    expect(svc.healthCheck().state).toBe('degraded');
  });

  it('enable/disable without onLoad resolves safely without throwing', async () => {
    const svc = new SimplifyTextService();
    await expect(svc.onEnable()).resolves.toBeUndefined();
    await expect(svc.onDisable()).resolves.toBeUndefined();
    expect(svc.healthCheck().state).toBe('degraded');
  });
});
