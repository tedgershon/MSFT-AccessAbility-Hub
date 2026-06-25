/**
 * Unit tests for the Input Personalization service.
 *
 * The service has no overlay/process handle — it just selects and exposes a
 * remapping profile from config. These tests assert the capability manifest,
 * profile selection, and health-state transitions.
 */

import { describe, expect, it } from 'vitest';
import { type ConfigStore, type EventPayload, type ServiceContext } from '@aah/contracts';
import { CapturingBus } from '@aah/test-fixtures';
import { InputPersonalizationService, INPUT_PROFILE_IDS } from './service.js';

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

function makeCtx(config: ConfigStore = fakeConfig()): ServiceContext {
  return { bus: new CapturingBus(), config, selfId: 'input-personalization' };
}

function makeCtxWithBus(
  config: ConfigStore = fakeConfig(),
): { ctx: ServiceContext; bus: CapturingBus } {
  const bus = new CapturingBus();
  return { ctx: { bus, config, selfId: 'input-personalization' }, bus };
}

function profileEvents(bus: CapturingBus): Array<EventPayload<'input/profile'>> {
  return bus.emitted
    .filter((e) => e.topic === 'input/profile')
    .map((e) => e.payload as EventPayload<'input/profile'>);
}

describe('InputPersonalizationService', () => {
  it('declares no capabilities — it shapes settings, not input itself', () => {
    const svc = new InputPersonalizationService();
    expect(svc.requires).toEqual([]);
  });

  it('defaults to the default profile (no remapping)', async () => {
    const svc = new InputPersonalizationService();
    await svc.onLoad(makeCtx());

    expect(svc.profile()).toEqual({
      id: 'default',
      dwellMs: 0,
      clickHoldMs: 0,
      keyRepeatFilterMs: 0,
      angleGainFloor: 1,
      clickSlipMaxPx: 0,
      areaCursorRadiusPx: 0,
    });
  });

  it('selects the configured profile', async () => {
    const svc = new InputPersonalizationService();
    await svc.onLoad(makeCtx(fakeConfig({ 'input-personalization.profile': 'tremor' })));

    expect(svc.profile()).toEqual({
      id: 'tremor',
      dwellMs: 400,
      clickHoldMs: 250,
      keyRepeatFilterMs: 120,
      angleGainFloor: 0.4,
      clickSlipMaxPx: 12,
      areaCursorRadiusPx: 18,
    });
  });

  it('falls back to the default profile when config is unknown', async () => {
    const svc = new InputPersonalizationService();
    await svc.onLoad(makeCtx(fakeConfig({ 'input-personalization.profile': 'nope' })));

    expect(svc.profile().id).toBe('default');
  });

  it('healthCheck reflects load + enable state transitions', async () => {
    const svc = new InputPersonalizationService();

    expect(svc.healthCheck().state).toBe('degraded');
    expect(svc.healthCheck().detail).toBe('not loaded');

    await svc.onLoad(makeCtx(fakeConfig({ 'input-personalization.profile': 'switch-access' })));
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onEnable();
    expect(svc.healthCheck().detail).toBe('active (profile=switch-access)');

    await svc.onDisable();
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onUnload();
    expect(svc.healthCheck().state).toBe('degraded');
  });

  it('broadcasts the active profile on enable', async () => {
    const { ctx, bus } = makeCtxWithBus(fakeConfig({ 'input-personalization.profile': 'tremor' }));
    const svc = new InputPersonalizationService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    const events = profileEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      source: 'input-personalization',
      profile: {
        id: 'tremor',
        dwellMs: 400,
        clickHoldMs: 250,
        keyRepeatFilterMs: 120,
        angleGainFloor: 0.4,
        clickSlipMaxPx: 12,
        areaCursorRadiusPx: 18,
      },
    });
  });

  it('re-broadcasts when the profile is switched at runtime while enabled', async () => {
    const { ctx, bus } = makeCtxWithBus();
    const svc = new InputPersonalizationService();
    await svc.onLoad(ctx);
    await svc.onEnable(); // broadcasts default

    svc.setProfile('switch-access');

    const events = profileEvents(bus);
    expect(events).toHaveLength(2);
    expect(events[1].profile.id).toBe('switch-access');
    expect(svc.profile().id).toBe('switch-access');
  });

  it('ignores unknown and no-op profile switches', async () => {
    const { ctx, bus } = makeCtxWithBus();
    const svc = new InputPersonalizationService();
    await svc.onLoad(ctx);
    await svc.onEnable(); // broadcasts default (1)

    svc.setProfile('default'); // no-op, same profile
    svc.setProfile('nope' as never); // unknown id

    expect(profileEvents(bus)).toHaveLength(1);
  });

  it('does not broadcast a runtime switch while disabled', async () => {
    const { ctx, bus } = makeCtxWithBus();
    const svc = new InputPersonalizationService();
    await svc.onLoad(ctx); // not enabled

    svc.setProfile('tremor');

    expect(profileEvents(bus)).toHaveLength(0);
    expect(svc.profile().id).toBe('tremor'); // selection still applied
  });

  it('hands out a shaper bound to the active profile', async () => {
    const svc = new InputPersonalizationService();
    await svc.onLoad(makeCtx(fakeConfig({ 'input-personalization.profile': 'tremor' })));

    const shaper = svc.shaper();
    expect(shaper.profile.id).toBe('tremor');
    // The tremor profile debounces key repeats, proving the shaper got its timings.
    expect(shaper.filterKeydown('a', 0)).toBe(true);
    expect(shaper.filterKeydown('a', 50)).toBe(false);
  });

  it('exposes the selectable profile ids', () => {
    expect(INPUT_PROFILE_IDS).toEqual(['default', 'tremor', 'switch-access']);
  });
});
