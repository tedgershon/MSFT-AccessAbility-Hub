/**
 * Unit tests for the Input Personalization service.
 *
 * The service has no overlay/process handle — it just selects and exposes a
 * remapping profile from config. These tests assert the capability manifest,
 * profile selection, and health-state transitions.
 */

import { describe, expect, it } from 'vitest';
import { type ConfigStore, type ServiceContext } from '@aah/contracts';
import { CapturingBus } from '@aah/test-fixtures';
import { InputPersonalizationService } from './service.js';

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
});
