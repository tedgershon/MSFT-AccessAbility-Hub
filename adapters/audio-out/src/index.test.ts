import { describe, expect, it } from 'vitest';
import { AudioOutAdapter, RecordingSpeechSink, type SpeechBackend } from './index.js';

describe('RecordingSpeechSink', () => {
  it('records spoken text + urgency only while open', () => {
    const sink = new RecordingSpeechSink();
    expect(() => sink.speak('hi', false)).toThrow();

    sink.open();
    sink.speak('brush tool selected', false);
    sink.speak('Export dialog opened', true);
    expect(sink.spoken).toEqual([
      { text: 'brush tool selected', assertive: false },
      { text: 'Export dialog opened', assertive: true },
    ]);

    sink.close();
    expect(sink.isOpen).toBe(false);
    expect(sink.openCount).toBe(1);
    expect(sink.closeCount).toBe(1);
  });
});

describe('AudioOutAdapter', () => {
  function recordingBackend(): { backend: SpeechBackend; calls: string[] } {
    const calls: string[] = [];
    const backend: SpeechBackend = {
      speak: (text, assertive) => calls.push(`speak:${assertive ? '!' : ''}${text}`),
      cancel: () => calls.push('cancel'),
    };
    return { backend, calls };
  }

  it('delegates speak to the backend while open', () => {
    const { backend, calls } = recordingBackend();
    const sink = new AudioOutAdapter(backend);
    expect(() => sink.speak('x', false)).toThrow();

    sink.open();
    sink.speak('hello', false);
    sink.speak('urgent', true);
    expect(calls).toEqual(['speak:hello', 'speak:!urgent']);
  });

  it('cancels queued speech when the lease is released', () => {
    const { backend, calls } = recordingBackend();
    const sink = new AudioOutAdapter(backend);
    sink.open();
    sink.close();
    expect(calls).toEqual(['cancel']);
    expect(sink.isOpen).toBe(false);
  });
});
