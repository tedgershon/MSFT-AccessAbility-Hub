/**
 * Text-to-speech (TTS) adapter.
 *
 * Wraps a speech engine behind a narrow interface so services never call a speech
 * API directly (Adapter pattern). Speaking corresponds to an `audioOut` lease the
 * service holds; releasing it (`close`) MUST happen on service disable. A service
 * injects a backend: {@link WebSpeechTtsBackend} in the Electron shell, or
 * {@link FakeTtsBackend} in tests.
 */

export interface SpeakOptions {
  /** Optional voice id/name hint for backends that support voice selection. */
  voice?: string;
  /** Relative speech rate (1 = normal). */
  rate?: number;
  /** Relative pitch (1 = normal). */
  pitch?: number;
}

export interface TtsBackend {
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  cancel(): void;
  close(): void;
}

/**
 * Narrow renderer-facing bindings so this package does not import Electron or the
 * DOM directly. The shell implements `speak`/`cancel` by forwarding to the
 * renderer's Web Speech `speechSynthesis`.
 */
export interface WebSpeechBindings {
  speak(text: string, opts?: SpeakOptions): void;
  cancel(): void;
}

export class WebSpeechTtsBackend implements TtsBackend {
  constructor(private readonly bindings: WebSpeechBindings) {}

  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    this.bindings.speak(text, opts);
  }

  cancel(): void {
    this.bindings.cancel();
  }

  close(): void {
    this.bindings.cancel();
  }
}

export interface SpokenUtterance {
  text: string;
  opts?: SpeakOptions;
}

/** Deterministic, hardware-free backend for tests: records what was spoken. */
export class FakeTtsBackend implements TtsBackend {
  readonly spoken: SpokenUtterance[] = [];
  cancelled = 0;
  closed = false;

  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    this.spoken.push({ text, opts });
  }

  cancel(): void {
    this.cancelled += 1;
  }

  close(): void {
    this.closed = true;
  }
}

/**
 * Wraps a {@link TtsBackend}. `open()` acquires the `audioOut` lease, `close()`
 * releases it. `speak()` before `open()` is a programming error.
 */
export class TtsAdapter {
  #open = false;

  constructor(private readonly backend: TtsBackend) {}

  open(): void {
    this.#open = true;
  }

  async speak(text: string, opts?: SpeakOptions): Promise<void> {
    if (!this.#open) {
      throw new Error('tts is not open; call open() first');
    }
    return this.backend.speak(text, opts);
  }

  cancel(): void {
    if (this.#open) this.backend.cancel();
  }

  close(): void {
    if (this.#open) this.backend.close();
    this.#open = false;
  }

  get isOpen(): boolean {
    return this.#open;
  }
}
