/**
 * In-memory channel pair — a headless stand-in for a real transport.
 *
 * `createChannelPair()` returns two linked {@link Channel}s: a frame sent on one is
 * delivered to the other end's `onMessage` handlers. Delivery is SYNCHRONOUS — a
 * `send` runs the peer's handlers before it returns — so tests are deterministic and
 * need no awaits. (A real stdio/socket transport would be async; the bridge's
 * echo-guard is written to be correct under either timing.)
 */

import type { Channel } from './channel.js';
import type { Frame } from './frame.js';

type FrameHandler = (frame: Frame) => void;

class InMemoryChannel implements Channel {
  readonly #handlers = new Set<FrameHandler>();
  #peer?: InMemoryChannel;
  #closed = false;

  /** @internal — wire this end to its peer (called by {@link createChannelPair}). */
  link(peer: InMemoryChannel): void {
    this.#peer = peer;
  }

  send(frame: Frame): void {
    if (this.#closed) return;
    const peer = this.#peer;
    if (!peer || peer.#closed) return;
    // Copy so a handler that (un)subscribes during delivery can't mutate mid-loop.
    for (const handler of [...peer.#handlers]) handler(frame);
  }

  onMessage(handler: FrameHandler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  close(): void {
    this.#closed = true;
    this.#handlers.clear();
  }
}

export function createChannelPair(): { host: Channel; child: Channel } {
  const host = new InMemoryChannel();
  const child = new InMemoryChannel();
  host.link(child);
  child.link(host);
  return { host, child };
}
