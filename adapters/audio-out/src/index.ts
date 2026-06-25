/**
 * Audio-out adapter.
 *
 * Wraps text-to-speech behind a narrow, leasable sink so services never touch the
 * speech API directly (Adapter pattern). Holding the sink open corresponds to an
 * `audioOut` lease the owning service holds; the service MUST `close()` it on
 * disable, which also cancels any queued speech.
 *
 * The real engine is abstracted behind {@link SpeechBackend}, so the adapter runs
 * hardware-free in tests via {@link RecordingSpeechSink}. The default real backend
 * ({@link WebSpeechBackend}) talks to the Web Speech API, guarded so this module
 * imports cleanly in environments without `speechSynthesis`.
 */

/**
 * Leased audio-out sink that speaks short utterances. `assertive` speech may flush
 * anything queued so completions/errors aren't missed.
 */
export interface SpeechSink {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  speak(text: string, assertive: boolean): void;
}

/** The narrow speech engine the adapter drives. */
export interface SpeechBackend {
  /** Speak `text`; when `assertive`, cancel anything in flight first. */
  speak(text: string, assertive: boolean): void;
  /** Stop and clear any queued/active speech. */
  cancel(): void;
}

/**
 * Real sink: delegates to a {@link SpeechBackend}. Keeps only the open/closed lease
 * flag; speaking only happens between `open()` and `close()`, and `close()` cancels.
 */
export class AudioOutAdapter implements SpeechSink {
  #open = false;
  readonly #backend: SpeechBackend;

  constructor(backend: SpeechBackend) {
    this.#backend = backend;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    if (this.#open) {
      this.#open = false;
      this.#backend.cancel();
    }
  }

  speak(text: string, assertive: boolean): void {
    if (!this.#open) throw new Error('speak() before open()');
    this.#backend.speak(text, assertive);
  }
}

/** Hardware-free sink that records what was spoken (for tests). */
export class RecordingSpeechSink implements SpeechSink {
  #open = false;
  openCount = 0;
  closeCount = 0;
  readonly spoken: Array<{ text: string; assertive: boolean }> = [];

  get isOpen(): boolean {
    return this.#open;
  }

  open(): void {
    if (!this.#open) {
      this.#open = true;
      this.openCount += 1;
    }
  }

  close(): void {
    if (this.#open) {
      this.#open = false;
      this.closeCount += 1;
    }
  }

  speak(text: string, assertive: boolean): void {
    if (!this.#open) throw new Error('speak() before open()');
    this.spoken.push({ text, assertive });
  }
}

/**
 * Real backend over the Web Speech API (`speechSynthesis`). The API is resolved
 * lazily and guarded, so importing this module never requires a browser/Electron
 * renderer context; in a headless host every call is a no-op.
 */
export class WebSpeechBackend implements SpeechBackend {
  speak(text: string, assertive: boolean): void {
    const synth = globalThis.speechSynthesis;
    if (!synth || typeof globalThis.SpeechSynthesisUtterance === 'undefined') return;
    if (assertive) synth.cancel();
    synth.speak(new globalThis.SpeechSynthesisUtterance(text));
  }

  cancel(): void {
    globalThis.speechSynthesis?.cancel();
  }
}
