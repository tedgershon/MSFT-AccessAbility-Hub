/**
 * Unit tests for the Simplify Text service.
 *
 * Unlike colorblind-contrast (a passive display overlay), this service actively
 * transforms content: it subscribes to `simplifyText/request` events, runs the
 * selected text through a transform strategy, and re-injects the result as
 * `input/intent` (keyboard) via the input multiplexer — never touching the overlay
 * surface at all.
 *
 * Tests drive the full request→transform→inject flow using a {@link CapturingBus}.
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

function intentEvents(bus: CapturingBus): Array<EventPayload<'input/intent'>> {
  return bus.emitted
    .filter((e) => e.topic === 'input/intent')
    .map((e) => e.payload as EventPayload<'input/intent'>);
}

function resultEvents(bus: CapturingBus): Array<EventPayload<'simplifyText/result'>> {
  return bus.emitted
    .filter((e) => e.topic === 'simplifyText/result')
    .map((e) => e.payload as EventPayload<'simplifyText/result'>);
}

describe('SimplifyTextService', () => {
  it('declares commandChannel:exclusive — not a display overlay', () => {
    const svc = new SimplifyTextService();
    expect(svc.requires).toEqual([{ resource: 'commandChannel', mode: 'exclusive' }]);
  });

  it('re-injects transformed text via input/intent on a simplifyText/request', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    bus.emit('simplifyText/request', { text: 'The patient should take medication.' });

    const intents = intentEvents(bus);
    expect(intents).toHaveLength(1);
    expect(intents[0].source).toBe('simplify-text');
    expect(intents[0].kind).toBe('keyboard');
    // Transform is stubbed (identity) — asserts the plumbing, not the AI output.
    expect((intents[0].payload as { text: string }).text).toBe(
      'The patient should take medication.',
    );
  });

  it('emits simplifyText/result with original, transformed text and active mode', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    bus.emit('simplifyText/request', { text: 'Complex text.' });

    const results = resultEvents(bus);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      original: 'Complex text.',
      transformed: 'Complex text.',
      mode: 'simplify',
    });
  });

  it('stops handling requests after onDisable', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();
    await svc.onDisable();

    bus.emit('simplifyText/request', { text: 'Should be ignored.' });

    expect(intentEvents(bus)).toHaveLength(0);
    expect(resultEvents(bus)).toHaveLength(0);
  });

  it('uses RestructureStrategy when configured (NAPE cognitive-style mode)', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'simplifyText.mode': 'restructure' }));
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    bus.emit('simplifyText/request', { text: 'Learning material.' });

    expect(resultEvents(bus)[0].mode).toBe('restructure');
    expect(svc.healthCheck().detail).toBe('active (restructure)');
  });

  it('falls back to simplify when configured mode is unrecognised', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'simplifyText.mode': 'unknown' }));
    const svc = new SimplifyTextService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    bus.emit('simplifyText/request', { text: 'text' });

    expect(resultEvents(bus)[0].mode).toBe('simplify');
  });

  it('healthCheck reflects full lifecycle transitions', async () => {
    const { ctx } = makeCtx();
    const svc = new SimplifyTextService();

    expect(svc.healthCheck().state).toBe('degraded');
    expect(svc.healthCheck().detail).toBe('not loaded');

    await svc.onLoad(ctx);
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onEnable();
    expect(svc.healthCheck().detail).toBe('active (simplify)');

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
