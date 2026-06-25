import { describe, expect, it, vi } from 'vitest';
import type { BridgeMessage } from '@aah/kernel';
import { NdjsonChildProcessTransport, type ChildProcessLike } from './python-service-bridge.js';

/** Fake child process that captures stdin writes and lets a test push stdout data. */
function createFakeChild(): ChildProcessLike & {
  written: string[];
  pushStdout(chunk: string): void;
  killed: boolean;
} {
  let dataListener: ((chunk: string | Uint8Array) => void) | undefined;
  const state = {
    written: [] as string[],
    killed: false,
    stdin: {
      write(chunk: string): void {
        state.written.push(chunk);
      },
    },
    stdout: {
      on(_event: 'data', listener: (chunk: string | Uint8Array) => void): void {
        dataListener = listener;
      },
    },
    kill(): void {
      state.killed = true;
    },
    pushStdout(chunk: string): void {
      dataListener?.(chunk);
    },
  };
  return state;
}

describe('NdjsonChildProcessTransport', () => {
  it('serializes sent messages as one NDJSON line', () => {
    const child = createFakeChild();
    const transport = new NdjsonChildProcessTransport(child);

    transport.send({ topic: 'display/frame-ref', payload: { width: 1920 } });

    expect(child.written).toEqual(['{"topic":"display/frame-ref","payload":{"width":1920}}\n']);
  });

  it('parses a complete inbound line and dispatches it', () => {
    const child = createFakeChild();
    const transport = new NdjsonChildProcessTransport(child);
    const handler = vi.fn();
    transport.onMessage(handler);

    child.pushStdout('{"topic":"gaze/point","payload":{"x":1}}\n');

    expect(handler).toHaveBeenCalledWith({ topic: 'gaze/point', payload: { x: 1 } });
  });

  it('buffers a message split across multiple stdout chunks', () => {
    const child = createFakeChild();
    const transport = new NdjsonChildProcessTransport(child);
    const handler = vi.fn();
    transport.onMessage(handler);

    child.pushStdout('{"topic":"gaze/point",');
    expect(handler).not.toHaveBeenCalled();
    child.pushStdout('"payload":{"x":2}}\n');

    expect(handler).toHaveBeenCalledWith({ topic: 'gaze/point', payload: { x: 2 } });
  });

  it('dispatches multiple messages arriving in one chunk', () => {
    const child = createFakeChild();
    const transport = new NdjsonChildProcessTransport(child);
    const messages: BridgeMessage[] = [];
    transport.onMessage((m) => messages.push(m));

    child.pushStdout('{"topic":"a","payload":1}\n{"topic":"b","payload":2}\n');

    expect(messages).toEqual([
      { topic: 'a', payload: 1 },
      { topic: 'b', payload: 2 },
    ]);
  });

  it('drops a malformed line without throwing', () => {
    const child = createFakeChild();
    const transport = new NdjsonChildProcessTransport(child);
    const handler = vi.fn();
    transport.onMessage(handler);

    child.pushStdout('not json\n{"topic":"ok","payload":3}\n');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ topic: 'ok', payload: 3 });
  });

  it('kills the child process on close()', () => {
    const child = createFakeChild();
    const transport = new NdjsonChildProcessTransport(child);

    transport.close();

    expect(child.killed).toBe(true);
  });
});
