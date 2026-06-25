import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { healthy } from '@aah/contracts';
import { encodeFrame, type Frame } from './frame.js';
import { StdioChannel } from './stdio-channel.js';

/**
 * Drive a StdioChannel with in-memory streams. `input` feeds bytes the channel reads;
 * `output` captures bytes the channel writes. No real process is spawned — these are
 * plain node:stream PassThroughs (CI runs TS in a Node-only env with no python/uv).
 */
function makeChannel(opts?: { onError?: (e: unknown, line: string) => void }): {
  channel: StdioChannel;
  input: PassThrough;
  output: PassThrough;
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const channel = new StdioChannel(input, output, opts);
  return { channel, input, output };
}

describe('StdioChannel', () => {
  it('dispatches a single frame written as one NDJSON line', () => {
    const { channel, input } = makeChannel();
    const received: Frame[] = [];
    channel.onMessage((f) => received.push(f));

    const frame: Frame = { kind: 'lifecycle', phase: 'enable' };
    input.write(encodeFrame(frame) + '\n');

    expect(received).toEqual([frame]);
  });

  it('dispatches multiple frames delivered in a single chunk, in order', () => {
    const { channel, input } = makeChannel();
    const received: Frame[] = [];
    channel.onMessage((f) => received.push(f));

    const a: Frame = { kind: 'lifecycle', phase: 'load' };
    const b: Frame = { kind: 'lifecycle', phase: 'enable' };
    const c: Frame = { kind: 'event', topic: 'input/intent', payload: { command: 'go' } };
    input.write(encodeFrame(a) + '\n' + encodeFrame(b) + '\n' + encodeFrame(c) + '\n');

    expect(received).toEqual([a, b, c]);
  });

  it('buffers a frame split across two writes and dispatches once complete', () => {
    const { channel, input } = makeChannel();
    const received: Frame[] = [];
    channel.onMessage((f) => received.push(f));

    const frame: Frame = { kind: 'health', status: healthy('up') };
    const line = encodeFrame(frame) + '\n';
    const mid = Math.floor(line.length / 2);

    input.write(line.slice(0, mid));
    expect(received).toEqual([]); // not yet — no terminator seen

    input.write(line.slice(mid));
    expect(received).toEqual([frame]);
  });

  it('holds a trailing partial line until its terminator arrives', () => {
    const { channel, input } = makeChannel();
    const received: Frame[] = [];
    channel.onMessage((f) => received.push(f));

    const a: Frame = { kind: 'lifecycle', phase: 'disable' };
    const b: Frame = { kind: 'lifecycle', phase: 'unload' };
    // First full frame + the start of the second (no trailing newline yet).
    input.write(encodeFrame(a) + '\n' + encodeFrame(b).slice(0, 5));
    expect(received).toEqual([a]);

    input.write(encodeFrame(b).slice(5) + '\n');
    expect(received).toEqual([a, b]);
  });

  it('ignores empty lines', () => {
    const { channel, input } = makeChannel();
    const received: Frame[] = [];
    channel.onMessage((f) => received.push(f));

    const frame: Frame = { kind: 'lifecycle', phase: 'enable' };
    input.write('\n\n' + encodeFrame(frame) + '\n\n');

    expect(received).toEqual([frame]);
  });

  it('does not throw on a malformed line and still delivers later valid frames', () => {
    const errors: string[] = [];
    const { channel, input } = makeChannel({ onError: (_e, line) => errors.push(line) });
    const received: Frame[] = [];
    channel.onMessage((f) => received.push(f));

    const frame: Frame = { kind: 'lifecycle', phase: 'enable' };
    input.write('not json{{{\n' + encodeFrame(frame) + '\n');

    expect(errors).toEqual(['not json{{{']);
    expect(received).toEqual([frame]);
  });

  it('send() writes a newline-terminated JSON line to output', async () => {
    const { channel, output } = makeChannel();
    const frame: Frame = { kind: 'lifecycle', phase: 'load' };

    channel.send(frame);

    const chunk = output.read() as Buffer | null;
    expect(chunk).not.toBeNull();
    const text = chunk!.toString('utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trimEnd()).not.toContain('\n');
    expect(JSON.parse(text)).toEqual(frame);
  });

  it('stops dispatching after close()', () => {
    const { channel, input } = makeChannel();
    const received: Frame[] = [];
    channel.onMessage((f) => received.push(f));

    channel.close();
    input.write(encodeFrame({ kind: 'lifecycle', phase: 'enable' }) + '\n');

    expect(received).toEqual([]);
  });

  it('routes two StdioChannels over a pair of PassThroughs end to end', () => {
    const aToB = new PassThrough();
    const bToA = new PassThrough();
    const a = new StdioChannel(bToA, aToB); // a reads bToA, writes aToB
    const b = new StdioChannel(aToB, bToA); // b reads aToB, writes bToA

    const atB: Frame[] = [];
    const atA: Frame[] = [];
    b.onMessage((f) => atB.push(f));
    a.onMessage((f) => atA.push(f));

    a.send({ kind: 'lifecycle', phase: 'enable' });
    b.send({ kind: 'health', status: healthy('ok') });

    expect(atB).toEqual([{ kind: 'lifecycle', phase: 'enable' }]);
    expect(atA[0]?.kind).toBe('health');
  });
});
