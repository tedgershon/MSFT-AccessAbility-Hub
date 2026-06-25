/**
 * Channel — the transport abstraction.
 *
 * A `Channel` is one end of a bidirectional, frame-oriented pipe. It is deliberately
 * transport-agnostic: the in-memory pair (tests) and a future stdio/socket transport
 * both implement exactly this surface. Channels carry Frame OBJECTS; serialization
 * (via `encodeFrame`/`decodeFrame`) is a transport concern, not a channel concern.
 */

import type { Frame } from './frame.js';

export interface Channel {
  /** Push a frame to the peer end. */
  send(frame: Frame): void;
  /** Subscribe to frames arriving from the peer. Returns an unsubscribe fn. */
  onMessage(handler: (frame: Frame) => void): () => void;
  /** Tear down this end; further sends are no-ops and handlers are dropped. */
  close(): void;
}
