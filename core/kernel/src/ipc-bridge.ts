/**
 * IPC Event Bridge — the TS↔Python seam.
 *
 * Out-of-process (Python) services never call the kernel directly; they exchange
 * typed events across a transport. This bridge plugs an out-of-process service into
 * the in-process {@link EventBus}: it forwards a configured allowlist of topics from
 * the local bus OUT to the transport, and re-emits an allowlist of topics coming IN
 * from the transport back onto the local bus.
 *
 * The bridge is transport-agnostic (stdio child process, socket, ...): it only needs
 * a {@link BridgeTransport}. Keeping it pure makes the seam unit-testable without a
 * real subprocess.
 */

import type { EventBus, EventPayload, EventTopic } from '@aah/contracts';

/** A single event crossing the IPC seam. `payload` is JSON-serializable. */
export interface BridgeMessage {
  topic: EventTopic;
  payload: unknown;
}

/** Narrow transport the bridge writes to and reads from. */
export interface BridgeTransport {
  /** Send one message to the remote process. */
  send(message: BridgeMessage): void;
  /** Register the single handler invoked for each inbound message. */
  onMessage(handler: (message: BridgeMessage) => void): void;
  /** Tear down the transport (kill the process / close the socket). */
  close(): void;
}

export interface IpcEventBridgeOptions {
  /** Topics forwarded from the local bus OUT to the transport (kernel → remote). */
  readonly toTransport: readonly EventTopic[];
  /** Topics accepted FROM the transport and re-emitted locally (remote → kernel). */
  readonly fromTransport: readonly EventTopic[];
}

export class IpcEventBridge {
  readonly #bus: EventBus;
  readonly #transport: BridgeTransport;
  readonly #toTransport: readonly EventTopic[];
  readonly #fromTransport: ReadonlySet<EventTopic>;
  readonly #unsubscribes: Array<() => void> = [];
  #started = false;
  // Guards against an echo loop when a topic is both inbound and outbound: while we
  // inject a message received from the transport, suppress re-forwarding it back out.
  #injecting = false;

  constructor(bus: EventBus, transport: BridgeTransport, options: IpcEventBridgeOptions) {
    this.#bus = bus;
    this.#transport = transport;
    this.#toTransport = options.toTransport;
    this.#fromTransport = new Set(options.fromTransport);
  }

  /** Begin forwarding in both directions. Idempotent. */
  start(): void {
    if (this.#started) return;
    this.#started = true;

    for (const topic of this.#toTransport) {
      const dispose = this.#bus.on(topic, (payload) => {
        if (this.#injecting) return;
        this.#transport.send({ topic, payload });
      });
      this.#unsubscribes.push(dispose);
    }

    this.#transport.onMessage((message) => this.#inject(message));
  }

  /** Stop forwarding and tear down the transport. Idempotent. */
  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    for (const dispose of this.#unsubscribes) dispose();
    this.#unsubscribes.length = 0;
    this.#transport.close();
  }

  #inject(message: BridgeMessage): void {
    if (!this.#fromTransport.has(message.topic)) return;
    this.#injecting = true;
    try {
      this.#bus.emit(message.topic, message.payload as EventPayload<EventTopic>);
    } finally {
      this.#injecting = false;
    }
  }
}
