import { describe, expect, it } from 'vitest';
import { type ConfigStore, type EventPayload, type ServiceContext } from '@aah/contracts';
import { CapturingBus } from '@aah/test-fixtures';
import { CreativeStudioService } from './service.js';
import { RecordingSpeechSink, ScriptedStudioChannel } from './channel.js';
import { emptyState, type StudioState } from './narration.js';

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

function makeCtx(): { ctx: ServiceContext; bus: CapturingBus } {
  const bus = new CapturingBus();
  return { ctx: { bus, config: fakeConfig(), selfId: 'creative-studio' }, bus };
}

function state(overrides: Partial<StudioState> = {}): StudioState {
  return { ...emptyState('image-editor'), ...overrides };
}

function intents(bus: CapturingBus): Array<EventPayload<'input/intent'>> {
  return bus.emitted
    .filter((e) => e.topic === 'input/intent')
    .map((e) => e.payload as EventPayload<'input/intent'>);
}

describe('CreativeStudioService', () => {
  it('declares shared commandChannel, audioOut, cursor, and keyboard', () => {
    const svc = new CreativeStudioService();
    expect(svc.requires).toEqual([
      { resource: 'commandChannel', mode: 'shared' },
      { resource: 'audioOut', mode: 'shared' },
      { resource: 'cursor', mode: 'shared' },
      { resource: 'keyboard', mode: 'shared' },
    ]);
  });

  it('opens both leases on enable and releases them on disable', async () => {
    const channel = new ScriptedStudioChannel();
    const speech = new RecordingSpeechSink();
    const svc = new CreativeStudioService({ channel, speech });
    const { ctx } = makeCtx();

    await svc.onLoad(ctx);
    await svc.onEnable();
    expect(channel.isOpen).toBe(true);
    expect(speech.isOpen).toBe(true);

    await svc.onDisable();
    expect(channel.isOpen).toBe(false);
    expect(speech.isOpen).toBe(false);
    expect(channel.closeCount).toBe(1);
    expect(speech.closeCount).toBe(1);
  });

  it('tick narrates state changes to the speech sink', async () => {
    const channel = new ScriptedStudioChannel([state({ tool: 'brush', zoom: 2 })]);
    const speech = new RecordingSpeechSink();
    const svc = new CreativeStudioService({ channel, speech });
    const { ctx } = makeCtx();

    await svc.onLoad(ctx);
    await svc.onEnable();
    const spoken = svc.tick();

    const texts = spoken.map((u) => u.text);
    expect(texts).toContain('brush tool selected');
    expect(texts).toContain('Zoom 200 percent');
    expect(speech.spoken.map((u) => u.text)).toEqual(texts);
  });

  it('tick is a no-op when nothing new is on the channel', async () => {
    const channel = new ScriptedStudioChannel([]);
    const svc = new CreativeStudioService({ channel });
    const { ctx } = makeCtx();
    await svc.onLoad(ctx);
    await svc.onEnable();
    expect(svc.tick()).toEqual([]);
  });

  it('tick before enable does nothing', async () => {
    const svc = new CreativeStudioService({ channel: new ScriptedStudioChannel([state()]) });
    const { ctx } = makeCtx();
    await svc.onLoad(ctx);
    expect(svc.tick()).toEqual([]);
  });

  it('runWorkflow emits input intents through the bus (mux)', async () => {
    const svc = new CreativeStudioService();
    const { ctx, bus } = makeCtx();
    await svc.onLoad(ctx);
    await svc.onEnable();

    const result = await svc.runWorkflow('export-png');
    expect(result.ran).toBe(true);
    const emitted = intents(bus);
    expect(emitted).toHaveLength(2);
    // The originator is on the event's top-level `source`; the payload is the
    // pure action data, with no redundant/hard-coded source key.
    expect(emitted[0]).toEqual({
      source: 'creative-studio',
      kind: 'keyboard',
      payload: { keys: 'Ctrl+Shift+E' },
    });
  });

  it('runWorkflow is refused before enable', async () => {
    const svc = new CreativeStudioService();
    const { ctx, bus } = makeCtx();
    await svc.onLoad(ctx);
    expect(await svc.runWorkflow('save')).toEqual({ id: 'save', ran: false, steps: 0 });
    expect(intents(bus)).toHaveLength(0);
  });

  it('exposes the available workflow ids once loaded', async () => {
    const svc = new CreativeStudioService();
    expect(svc.workflows()).toEqual([]);
    await svc.onLoad(makeCtx().ctx);
    expect(svc.workflows()).toEqual(['export-png', 'save', 'undo']);
  });

  it('healthCheck reflects load/enable/disable transitions', async () => {
    const svc = new CreativeStudioService();
    const { ctx } = makeCtx();

    expect(svc.healthCheck().state).toBe('degraded');
    expect(svc.healthCheck().detail).toBe('not loaded');

    await svc.onLoad(ctx);
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onEnable();
    expect(svc.healthCheck().detail).toBe('mediating');

    await svc.onDisable();
    expect(svc.healthCheck().detail).toBe('idle');

    await svc.onUnload();
    expect(svc.healthCheck().state).toBe('degraded');
  });

  it('healthCheck degrades if a lease is lost while enabled', async () => {
    const channel = new ScriptedStudioChannel();
    const svc = new CreativeStudioService({ channel });
    const { ctx } = makeCtx();
    await svc.onLoad(ctx);
    await svc.onEnable();

    channel.close(); // lease yanked out from under the service
    const status = svc.healthCheck();
    expect(status.state).toBe('degraded');
    expect(status.detail).toBe('studio lease lost');
  });

  it('does not touch the seams before it is loaded', async () => {
    const svc = new CreativeStudioService();
    await expect(svc.onEnable()).resolves.toBeUndefined();
    await expect(svc.onDisable()).resolves.toBeUndefined();
    expect(svc.healthCheck().state).toBe('degraded');
  });
});
