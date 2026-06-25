import { describe, expect, it } from 'vitest';
import type { Frame } from './frame.js';
import { spawnServiceChannel } from './spawn.js';

/**
 * Inline Node program used as the child: read NDJSON lines from stdin and echo each
 * complete line straight back to stdout. We deliberately use a NODE child
 * (`process.execPath`) rather than python/uv — CI runs TS in a Node-only environment.
 */
const ECHO_SCRIPT = `
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.length > 0) process.stdout.write(line + '\\n');
  }
});
`;

function firstFrame(channel: { onMessage(h: (f: Frame) => void): () => void }): Promise<Frame> {
  return new Promise<Frame>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for echoed frame')), 5000);
    const unsub = channel.onMessage((frame) => {
      clearTimeout(timer);
      unsub();
      resolve(frame);
    });
  });
}

describe('spawnServiceChannel', () => {
  it('round-trips a frame through a spawned Node child over stdio', async () => {
    const spawned = spawnServiceChannel(process.execPath, ['-e', ECHO_SCRIPT]);
    try {
      const sent: Frame = { kind: 'lifecycle', phase: 'enable' };
      const arrived = firstFrame(spawned.channel);
      spawned.channel.send(sent);

      expect(await arrived).toEqual(sent);
    } finally {
      spawned.kill();
    }
  });

  it('echoes multiple frames in order', async () => {
    const spawned = spawnServiceChannel(process.execPath, ['-e', ECHO_SCRIPT]);
    try {
      const received: Frame[] = [];
      const got = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out')), 5000);
        spawned.channel.onMessage((frame) => {
          received.push(frame);
          if (received.length === 2) {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      spawned.channel.send({ kind: 'lifecycle', phase: 'load' });
      spawned.channel.send({ kind: 'lifecycle', phase: 'enable' });

      await got;
      expect(received).toEqual([
        { kind: 'lifecycle', phase: 'load' },
        { kind: 'lifecycle', phase: 'enable' },
      ]);
    } finally {
      spawned.kill();
    }
  });

  it('reports the child exit code via onExit after kill()', async () => {
    const exited = new Promise<number | null>((resolve) => {
      const spawned = spawnServiceChannel(process.execPath, ['-e', ECHO_SCRIPT], {
        onExit: (code) => resolve(code),
      });
      spawned.kill();
    });

    // Resolves (exit fired) regardless of the specific code/signal.
    await expect(Promise.race([exited, new Promise((_, r) => setTimeout(() => r(new Error('no exit')), 5000))])).resolves.toBeDefined();
  });
});
