/**
 * Unit tests for the Privacy Guard service.
 *
 * The service has no real hardware: it drives an injected display-capture adapter
 * (fake backend), a TTS adapter (fake backend), and a stub analyzer, then publishes
 * `overlay/attach` panels + `privacy/verdict` events on a {@link CapturingBus}. Tests
 * assert the captured → analyzed → assessed → announced + spoken pipeline, the verdict,
 * and lease discipline.
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
import { PrivacyGuardService } from './service.js';
import { type ShareAnalyzer } from './analyzer.js';
import { shareScene, type ShareScene } from './detectors.js';

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

const LAYER_ID = 'privacy-guard:warnings';

/** Analyzer that returns a fixed scene (and records that it was called). */
class StubAnalyzer implements ShareAnalyzer {
  calls = 0;
  constructor(private readonly scene: ShareScene = shareScene({ text: '' })) {}
  async analyze(): Promise<ShareScene | null> {
    this.calls += 1;
    return this.scene;
  }
}

function setup(opts: { scene?: ShareScene; analyzer?: ShareAnalyzer; withFrame?: boolean } = {}) {
  const backend = new FakeDisplayCaptureBackend([{ id: 'screen-1', name: 'Primary' }]);
  if (opts.withFrame !== false) backend.enqueueFrame('screen-1', FRAME);
  const capture = new DisplayCaptureAdapter(backend);
  const ttsBackend = new FakeTtsBackend();
  const tts = new TtsAdapter(ttsBackend);
  const analyzer = opts.analyzer ?? new StubAnalyzer(opts.scene);
  const service = new PrivacyGuardService({ capture, tts, analyzer });
  const bus = new CapturingBus();
  const ctx: ServiceContext = { bus, config: fakeConfig(), selfId: 'privacy-guard' };
  return { service, bus, ctx, ttsBackend, capture, tts, analyzer };
}

function panels(bus: CapturingBus): Array<EventPayload<'overlay/attach'>> {
  return bus.emitted
    .filter((e) => e.topic === 'overlay/attach')
    .map((e) => e.payload as EventPayload<'overlay/attach'>);
}

function verdicts(bus: CapturingBus): Array<EventPayload<'privacy/verdict'>> {
  return bus.emitted
    .filter((e) => e.topic === 'privacy/verdict')
    .map((e) => e.payload as EventPayload<'privacy/verdict'>);
}

describe('PrivacyGuardService', () => {
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

  it('blocks a share with a leaked secret: panel + spoken alert + verdict', async () => {
    const { service, ctx, bus, ttsBackend } = setup({
      scene: shareScene({ text: 'password: hunter2' }),
    });
    await service.onLoad(ctx);
    await service.onEnable();

    await service.scanNow('screen-1');

    const panel = panels(bus).at(-1);
    expect(panel?.id).toBe(LAYER_ID);
    expect(panel?.kind).toBe('privacy-warnings');
    expect(panel?.params).toMatchObject({ decision: 'block' });

    const verdict = verdicts(bus).at(-1);
    expect(verdict).toMatchObject({ sourceId: 'screen-1', decision: 'block' });
    expect(verdict?.findings.map((f) => f.key)).toEqual(['secret']);

    // Blind-first: a risky result interrupts in-flight speech and speaks the summary.
    expect(ttsBackend.cancelled).toBeGreaterThanOrEqual(1);
    expect(ttsBackend.spoken.at(-1)?.text).toContain('Hold before sharing');
  });

  it('allows a clean share: speaks the all-clear and does not interrupt', async () => {
    const { service, ctx, bus, ttsBackend } = setup({ scene: shareScene({ text: 'hi there' }) });
    await service.onLoad(ctx);
    await service.onEnable();

    await service.scanNow('screen-1');

    expect(verdicts(bus).at(-1)).toMatchObject({ decision: 'allow', findings: [] });
    expect(ttsBackend.spoken.at(-1)?.text).toBe('No private information detected. Safe to share.');
    expect(ttsBackend.cancelled).toBe(0);
  });

  it('runs the pipeline when a scan-requested event fires', async () => {
    const analyzer = new StubAnalyzer();
    const { service, ctx, bus } = setup({ analyzer });
    await service.onLoad(ctx);
    await service.onEnable();

    bus.emit('privacy/scan-requested', { sourceId: 'screen-1' });
    await vi.waitFor(() => expect(analyzer.calls).toBe(1));
  });

  it('ignores scan requests until enabled', async () => {
    const analyzer = new StubAnalyzer();
    const { service, ctx } = setup({ analyzer });
    await service.onLoad(ctx);

    await service.scanNow('screen-1');
    expect(analyzer.calls).toBe(0);
  });

  it('announces (assertively) when capture yields no frame', async () => {
    const { service, ctx, bus, ttsBackend } = setup({ withFrame: false });
    await service.onLoad(ctx);
    await service.onEnable();

    await service.scanNow('screen-1');
    expect(ttsBackend.spoken.at(-1)?.text).toContain('Could not capture the screen');
    expect(verdicts(bus)).toHaveLength(0);
  });

  it('stops scanning after unload (unsubscribes from the bus)', async () => {
    const analyzer = new StubAnalyzer();
    const { service, ctx, bus } = setup({ analyzer });
    await service.onLoad(ctx);
    await service.onEnable();
    await service.onDisable();
    await service.onUnload();

    bus.emit('privacy/scan-requested', { sourceId: 'screen-1' });
    await Promise.resolve();
    expect(analyzer.calls).toBe(0);
  });

  it('healthCheck reflects load + scan state', async () => {
    const { service, ctx } = setup({ scene: shareScene({ text: 'password: x' }) });
    expect(service.healthCheck().state).toBe('degraded');
    await service.onLoad(ctx);
    expect(service.healthCheck()).toMatchObject({ state: 'healthy', detail: 'idle' });
    await service.onEnable();
    expect(service.healthCheck().detail).toBe('ready');
    await service.scanNow('screen-1');
    expect(service.healthCheck().detail).toBe('scanned: block (1)');
  });
});
