import { describe, expect, it } from 'vitest';
import { healthy } from '@aah/contracts';
import { decodeFrame, encodeFrame, type Frame } from './frame.js';

describe('frame encode/decode', () => {
  it('round-trips an event frame', () => {
    const frame: Frame = {
      kind: 'event',
      topic: 'input/intent',
      payload: { source: 'py', kind: 'keyboard', payload: { command: 'go' } },
    };
    const line = encodeFrame(frame);
    expect(line).not.toContain('\n');
    expect(decodeFrame(line)).toEqual(frame);
  });

  it('round-trips a lifecycle frame', () => {
    const frame: Frame = { kind: 'lifecycle', phase: 'enable' };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });

  it('round-trips a health frame', () => {
    const frame: Frame = { kind: 'health', status: healthy('ok') };
    expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
  });
});
