/**
 * Unit tests for the adaptive-learning (NAPE) overlay service.
 *
 * The service has no renderer handle, so it mounts/unmounts its restructuring layer
 * on the shared overlay surface by emitting `overlay/attach` / `overlay/detach`.
 * These tests drive the lifecycle with a {@link CapturingBus} and assert what the
 * service published, plus the cognitive-style restructuring behaviour.
 */

import { describe, expect, it } from 'vitest';
import {
  type ConfigStore,
  type EventPayload,
  type ServiceContext,
} from '@aah/contracts';
import { CapturingBus } from '@aah/test-fixtures';
import { AdaptiveLearningService } from './service.js';
import { STRATEGIES } from './strategies.js';

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
  const ctx: ServiceContext = { bus, config, selfId: 'adaptive-learning' };
  return { ctx, bus };
}

const LAYER_ID = 'adaptive-learning:restructure';

/** All `overlay/attach` payloads the service published, in order. */
function attachEvents(bus: CapturingBus): Array<EventPayload<'overlay/attach'>> {
  return bus.emitted
    .filter((e) => e.topic === 'overlay/attach')
    .map((e) => e.payload as EventPayload<'overlay/attach'>);
}

/** All `overlay/detach` payloads the service published, in order. */
function detachEvents(bus: CapturingBus): Array<EventPayload<'overlay/detach'>> {
  return bus.emitted
    .filter((e) => e.topic === 'overlay/detach')
    .map((e) => e.payload as EventPayload<'overlay/detach'>);
}

describe('AdaptiveLearningService', () => {
  it('declares only a shared displayOverlay capability', () => {
    const svc = new AdaptiveLearningService();
    expect(svc.requires).toEqual([{ resource: 'displayOverlay', mode: 'shared' }]);
  });

  it('onEnable mounts an adaptive-text layer on the overlay surface', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new AdaptiveLearningService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    const events = attachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      id: LAYER_ID,
      ownerId: 'adaptive-learning',
      kind: 'adaptive-text',
      params: { style: 'adhd' },
    });
  });

  it('onDisable detaches the layer it attached', async () => {
    const { ctx, bus } = makeCtx();
    const svc = new AdaptiveLearningService();
    await svc.onLoad(ctx);
    await svc.onEnable();
    await svc.onDisable();

    const events = detachEvents(bus);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ id: LAYER_ID, ownerId: 'adaptive-learning' });
  });

  it('healthCheck reflects load + overlay state transitions', async () => {
    const { ctx } = makeCtx();
    const svc = new AdaptiveLearningService();

    expect(svc.healthCheck().state).toBe('degraded');
    expect(svc.healthCheck().detail).toBe('not loaded');

    await svc.onLoad(ctx);
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onEnable();
    expect(svc.healthCheck().detail).toBe('overlay active (adhd)');

    await svc.onDisable();
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onUnload();
    expect(svc.healthCheck().state).toBe('degraded');
  });

  it('selects the configured cognitive style and reflects it in the attached layer', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'adaptive-learning.style': 'dyslexia' }));
    const svc = new AdaptiveLearningService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(attachEvents(bus)[0].params).toEqual({ style: 'dyslexia' });
    expect(svc.healthCheck().detail).toBe('overlay active (dyslexia)');
    expect(svc.activeStyle).toBe('dyslexia');
  });

  it('falls back to the default style when config is unknown', async () => {
    const { ctx, bus } = makeCtx(fakeConfig({ 'adaptive-learning.style': 'nope' }));
    const svc = new AdaptiveLearningService();
    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(attachEvents(bus)[0].params).toEqual({ style: 'adhd' });
  });

  it('does not touch the overlay surface before it is loaded', async () => {
    const svc = new AdaptiveLearningService();
    // No onLoad → no ctx → enabling cannot emit (and must not throw).
    await expect(svc.onEnable()).resolves.toBeUndefined();
    await expect(svc.onDisable()).resolves.toBeUndefined();
    expect(svc.healthCheck().state).toBe('degraded');
  });

  it('restructures on-screen text for the active cognitive style', async () => {
    const { ctx } = makeCtx(fakeConfig({ 'adaptive-learning.style': 'autism' }));
    const svc = new AdaptiveLearningService();
    await svc.onLoad(ctx);

    const source = 'Open the app. Find the menu. Pick a lesson.';
    expect(svc.restructure(source)).toBe(
      '1. Open the app.\n2. Find the menu.\n3. Pick a lesson.',
    );
  });
});

describe('cognitive-style strategies', () => {
  const source = 'Read the passage. Answer the questions.';

  it('ADHD chunks sentences into bullets', () => {
    expect(STRATEGIES.adhd.restructure(source)).toBe(
      '• Read the passage.\n• Answer the questions.',
    );
  });

  it('dyslexia spaces words and isolates sentences on their own lines', () => {
    expect(STRATEGIES.dyslexia.restructure(source)).toBe(
      'Read  the  passage.\n\nAnswer  the  questions.',
    );
  });

  it('autism produces an explicit numbered step list', () => {
    expect(STRATEGIES.autism.restructure(source)).toBe(
      '1. Read the passage.\n2. Answer the questions.',
    );
  });

  it('every strategy returns empty/whitespace input unchanged (trimmed)', () => {
    for (const strategy of Object.values(STRATEGIES)) {
      expect(strategy.restructure('   ')).toBe('');
    }
  });
});
