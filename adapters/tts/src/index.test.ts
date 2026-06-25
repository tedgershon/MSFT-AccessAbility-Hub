import { describe, expect, it } from 'vitest';
import {
  FakeTtsBackend,
  TtsAdapter,
  WebSpeechTtsBackend,
  type WebSpeechBindings,
} from './index.js';

describe('TtsAdapter', () => {
  it('requires open before speaking', async () => {
    const adapter = new TtsAdapter(new FakeTtsBackend());
    await expect(adapter.speak('hello')).rejects.toThrow('tts is not open; call open() first');
  });

  it('speaks through the backend while open and releases on close', async () => {
    const backend = new FakeTtsBackend();
    const adapter = new TtsAdapter(backend);

    adapter.open();
    expect(adapter.isOpen).toBe(true);
    await adapter.speak('a portrait of a woman', { rate: 1.1 });
    await adapter.speak('a sunlit landscape');

    expect(backend.spoken).toEqual([
      { text: 'a portrait of a woman', opts: { rate: 1.1 } },
      { text: 'a sunlit landscape', opts: undefined },
    ]);

    adapter.cancel();
    expect(backend.cancelled).toBe(1);

    adapter.close();
    expect(backend.closed).toBe(true);
    expect(adapter.isOpen).toBe(false);
  });

  it('ignores cancel/close when not open', () => {
    const backend = new FakeTtsBackend();
    const adapter = new TtsAdapter(backend);
    adapter.cancel();
    adapter.close();
    expect(backend.cancelled).toBe(0);
    expect(backend.closed).toBe(false);
  });
});

describe('WebSpeechTtsBackend', () => {
  it('forwards speak and cancel to the renderer bindings', async () => {
    const calls: string[] = [];
    const bindings: WebSpeechBindings = {
      speak(text) {
        calls.push(`speak:${text}`);
      },
      cancel() {
        calls.push('cancel');
      },
    };
    const backend = new WebSpeechTtsBackend(bindings);
    await backend.speak('hi');
    backend.cancel();
    backend.close();
    expect(calls).toEqual(['speak:hi', 'cancel', 'cancel']);
  });
});
