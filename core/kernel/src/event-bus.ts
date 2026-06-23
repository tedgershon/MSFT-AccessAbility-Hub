/**
 * Event Bus — Observer / Pub-Sub.
 *
 * The decoupling backbone of the hub. Services publish and subscribe to typed
 * topics; they never hold references to one another. In production the bus also
 * bridges to out-of-process (Python) services over IPC — that bridge plugs in here.
 */

import type {
  EventBus,
  EventHandler,
  EventPayload,
  EventTopic,
} from '@aah/contracts';

export class InMemoryEventBus implements EventBus {
  readonly #handlers = new Map<EventTopic, Set<EventHandler<EventTopic>>>();

  emit<T extends EventTopic>(topic: T, payload: EventPayload<T>): void {
    const set = this.#handlers.get(topic);
    if (!set) return;
    // Copy so a handler that (un)subscribes during dispatch can't mutate mid-loop.
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<T>)(payload);
      } catch (err) {
        // A misbehaving subscriber must never break the bus (crash isolation).
        // TODO: route to structured logging / supervisor.
        console.error(`[event-bus] handler for "${topic}" threw`, err);
      }
    }
  }

  on<T extends EventTopic>(topic: T, handler: EventHandler<T>): () => void {
    let set = this.#handlers.get(topic);
    if (!set) {
      set = new Set();
      this.#handlers.set(topic, set);
    }
    set.add(handler as EventHandler<EventTopic>);
    return () => this.off(topic, handler);
  }

  off<T extends EventTopic>(topic: T, handler: EventHandler<T>): void {
    this.#handlers.get(topic)?.delete(handler as EventHandler<EventTopic>);
  }
}
