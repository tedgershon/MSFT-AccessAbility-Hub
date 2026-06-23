/**
 * Shared Input Multiplexer (Adapter).
 *
 * Contract rule 4: serialize ALL cursor/keyboard injection through this one
 * multiplexer — no service drives the pointer directly. Services emit
 * `input/intent` events; the mux subscribes, serializes them through a single
 * queue, and is the only thing that calls the OS injection backend.
 *
 * Which source is allowed to inject at any moment is decided upstream by the
 * Resource Arbiter + Mode Coordinator; the mux only enforces serialization.
 */

import type { EventBus } from '@aah/contracts';

export interface InjectionBackend {
  injectCursor(payload: unknown): Promise<void>;
  injectKeyboard(payload: unknown): Promise<void>;
}

interface Intent {
  source: string;
  kind: 'cursor' | 'keyboard';
  payload: unknown;
}

export class InputMultiplexer {
  readonly #queue: Intent[] = [];
  #draining = false;
  #unsubscribe?: () => void;

  constructor(
    private readonly bus: EventBus,
    private readonly backend: InjectionBackend,
  ) {}

  start(): void {
    this.#unsubscribe ??= this.bus.on('input/intent', (intent) => {
      this.#queue.push(intent as Intent);
      void this.drain();
    });
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  private async drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#queue.length > 0) {
        const intent = this.#queue.shift()!;
        if (intent.kind === 'cursor') await this.backend.injectCursor(intent.payload);
        else await this.backend.injectKeyboard(intent.payload);
      }
    } finally {
      this.#draining = false;
    }
  }
}

/** Stub backend for the scaffold; replace with an OS-native injector. */
export class NoopInjectionBackend implements InjectionBackend {
  async injectCursor(): Promise<void> {
    // TODO: OS-native cursor injection (e.g. via Electron/native addon).
  }
  async injectKeyboard(): Promise<void> {
    // TODO: OS-native keyboard injection.
  }
}
