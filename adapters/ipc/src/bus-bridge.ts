/**
 * BusBridge — relays the in-process Event Bus across a {@link Channel}.
 *
 * This is the heart of the TS<->Python seam (hard rule #4): the two runtimes never
 * call each other; instead the bridge forwards a whitelist of bus topics outbound as
 * `event` frames, and re-emits inbound `event` frames onto the local bus.
 *
 * ## Echo guard
 * Without care the bridge loops forever: an inbound frame is re-emitted on the bus,
 * the outbound forward subscriber sees that emit and ships it straight back out, the
 * peer re-emits it, ... To break the cycle we mark a topic as "inbound" for the exact
 * (synchronous) window in which we re-emit it on the bus. The forward subscriber runs
 * inside that `emit` call (the bus dispatches synchronously), sees the flag, and skips
 * forwarding. The flag is cleared as soon as `emit` returns. Net effect: events that
 * ORIGINATE locally are forwarded out; events that ARRIVED from the peer are not sent
 * back to the peer.
 */

import type { EventBus, EventPayload, EventTopic } from '@aah/contracts';
import type { Channel } from './channel.js';

export interface BusBridgeOptions {
  /** Topics to relay outbound (local bus -> channel). */
  forward: readonly EventTopic[];
}

export class BusBridge {
  readonly #bus: EventBus;
  readonly #channel: Channel;
  readonly #forward: readonly EventTopic[];
  readonly #unsubscribes: Array<() => void> = [];
  #channelUnsub?: () => void;
  /** Topics currently being re-emitted from an inbound frame (echo guard). */
  readonly #inbound = new Set<EventTopic>();

  constructor(bus: EventBus, channel: Channel, opts: BusBridgeOptions) {
    this.#bus = bus;
    this.#channel = channel;
    this.#forward = opts.forward;
  }

  /** Subscribe both directions. Idempotent per instance is NOT guaranteed. */
  mount(): void {
    for (const topic of this.#forward) {
      const unsub = this.#bus.on(topic, (payload) => {
        if (this.#inbound.has(topic)) return; // echo guard: don't bounce it back
        this.#channel.send({ kind: 'event', topic, payload });
      });
      this.#unsubscribes.push(unsub);
    }

    this.#channelUnsub = this.#channel.onMessage((frame) => {
      if (frame.kind !== 'event') return;
      const topic = frame.topic;
      this.#inbound.add(topic);
      try {
        // Cast: the wire payload is opaque; trust the topic discriminator.
        this.#bus.emit(topic, frame.payload as EventPayload<typeof topic>);
      } finally {
        this.#inbound.delete(topic);
      }
    });
  }

  /** Unsubscribe both directions. Safe to call multiple times. */
  dispose(): void {
    for (const unsub of this.#unsubscribes) unsub();
    this.#unsubscribes.length = 0;
    this.#channelUnsub?.();
    this.#channelUnsub = undefined;
  }
}
