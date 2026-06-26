/**
 * Unit tests for the ArtInSight screen-description service.
 *
 * The service has no real hardware: it drives an injected display-capture adapter
 * (fake backend), a TTS adapter (fake backend), and a stub describer, then publishes
 * `overlay/attach` captions on a {@link CapturingBus}. Tests assert the captured →
 * described → captioned + spoken pipeline and lease discipline.
 */

import { describe, expect, it, vi } from 'vitest';
import { type ConfigStore, type EventPayload, type ServiceContext } from '@aah/contracts';
import { CapturingBus } from '@aah/test-fixtures';
import {
  DisplayCaptureAdapter,
  FakeDisplayCaptureBackend,
  type DisplayFrame,
} from '@aah/display-capture';
import { FakeTtsBackend, TtsAdapter } from '@aah/tts';
import { ArtInSightService } from './service.js';
import { type SceneDescriber } from './describer.js';

function fakeConfig(): ConfigStore {
  const store = new Map<string, unknown>();
  return {
    get<T = unknown>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    set<T = unknown>(key: string, value: T): void {
      store.set(key, value);
    },
  };
}

const FRAME: DisplayFrame = {
  sourceId: 'screen-1',
  capturedAtMs: 1,
  width: 8,
  height: 8,
  data: new Uint8Array([1, 2, 3, 4]),
};

const LAYER_ID = 'artinsight:description';

class StubDescriber implements SceneDescriber {
  calls = 0;
  constructor(private readonly text = 'a red square on a white wall') {}
  async describe(): Promise<string> {
    this.calls += 1;
    return this.text;
  }
}

function setup(opts: { describer?: SceneDescriber; withFrame?: boolean } = {}) {
  const backend = new FakeDisplayCaptureBackend([{ id: 'screen-1', name: 'Primary' }]);
  if (opts.withFrame !== false) backend.enqueueFrame('screen-1', FRAME);
  const capture = new DisplayCaptureAdapter(backend);
  const ttsBackend = new FakeTtsBackend();
  const tts = new TtsAdapter(ttsBackend);
  const describer = opts.describer ?? new StubDescriber();
  const service = new ArtInSightService({ capture, tts, describer });
  const bus = new CapturingBus();
  const ctx: ServiceContext = { bus, config: fakeConfig(), selfId: 'artinsight' };
  return { service, bus, ctx, ttsBackend, capture, tts };
}

function captions(bus: CapturingBus): Array<EventPayload<'overlay/attach'>> {
  return bus.emitted
    .filter((e) => e.topic === 'overlay/attach')
    .map((e) => e.payload as EventPayload<'overlay/attach'>);
}

describe('ArtInSightService', () => {
  it('declares only shared displayOverlay + audioOut capabilities', () => {
    const { service } = setup();
    expect(service.requires).toEqual([
      { resource: 'displayOverlay', mode: 'shared' },
      { resource: 'audioOut', mode: 'shared' },
    ]);
  });

  it('opens capture + tts on enable and releases both on disable', async () => {
    const { service, ctx, capture, tts, bus } = setup();
    await service.onLoad(ctx);
    await service.onEnable();
    expect(capture.isOpen).toBe(true);
    expect(tts.isOpen).toBe(true);

    await service.onDisable();
    expect(capture.isOpen).toBe(false);
    expect(tts.isOpen).toBe(false);
    expect(bus.emitted.filter((e) => e.topic === 'overlay/detach')).toHaveLength(1);
  });

  it('describes the screen: captures, captions, and speaks', async () => {
    const describer = new StubDescriber('a red square on a white wall');
    const { service, ctx, bus, ttsBackend } = setup({ describer });
    await service.onLoad(ctx);
    await service.onEnable();

    await service.describeNow('screen-1');

    expect(describer.calls).toBe(1);
    expect(captions(bus).at(-1)).toEqual({
      id: LAYER_ID,
      ownerId: 'artinsight',
      kind: 'caption',
      params: { text: 'a red square on a white wall' },
    });
    expect(ttsBackend.spoken.at(-1)).toEqual({
      text: 'a red square on a white wall',
      opts: undefined,
    });
  });

  it('runs the pipeline when a describe-requested event fires', async () => {
    const describer = new StubDescriber();
    const { service, ctx, bus } = setup({ describer });
    await service.onLoad(ctx);
    await service.onEnable();

    bus.emit('artinsight/describe-requested', {});
    await vi.waitFor(() => expect(describer.calls).toBe(1));
  });

  it('ignores describe requests until enabled', async () => {
    const describer = new StubDescriber();
    const { service, ctx } = setup({ describer });
    await service.onLoad(ctx);

    await service.describeNow('screen-1');
    expect(describer.calls).toBe(0);
  });

  it('announces when capture yields no frame', async () => {
    const { service, ctx, bus } = setup({ withFrame: false });
    await service.onLoad(ctx);
    await service.onEnable();

    await service.describeNow('screen-1');
    expect(captions(bus).at(-1)?.params).toEqual({ text: 'Could not capture the screen.' });
  });

  it('stops describing after unload (unsubscribes from the bus)', async () => {
    const describer = new StubDescriber();
    const { service, ctx, bus } = setup({ describer });
    await service.onLoad(ctx);
    await service.onEnable();
    await service.onDisable();
    await service.onUnload();

    bus.emit('artinsight/describe-requested', {});
    await Promise.resolve();
    expect(describer.calls).toBe(0);
  });

  it('healthCheck reflects load + run state', async () => {
    const { service, ctx } = setup();
    expect(service.healthCheck().state).toBe('degraded');
    await service.onLoad(ctx);
    expect(service.healthCheck()).toMatchObject({ state: 'healthy', detail: 'idle' });
    await service.onEnable();
    expect(service.healthCheck().detail).toBe('ready');
  });
});
