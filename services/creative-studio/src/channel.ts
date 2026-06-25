/**
 * The two leased seams Creative Studio holds open while enabled:
 *
 * - {@link StudioChannel} — the `commandChannel` lease: reads creative-app / screen
 *   state (accessibility tree, app introspection). Polled for state snapshots.
 * - {@link SpeechSink} — the `audioOut` lease: speaks narration to the user.
 *
 * Both are interfaces so the service stays hardware-free and unit-testable; the
 * scripted/recording fakes below stand in for the real adapters reached across the
 * IPC seam. Both leases are opened in `onEnable` and **released in `onDisable`**.
 */

import type { StudioState } from './narration.js';
import type { Utterance } from './narration.js';

/** Leased read channel to the mediated creative app. */
export interface StudioChannel {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  /** Latest state snapshot, or `null` when nothing new is available. */
  poll(): StudioState | null;
}

/** Leased audio-out sink that speaks narration. */
export interface SpeechSink {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  /** Speak an utterance. `assertive` ones may flush anything queued. */
  speak(utterance: Utterance): void;
}

/** Hardware-free channel that replays a fixed list of state snapshots. */
export class ScriptedStudioChannel implements StudioChannel {
  #open = false;
  openCount = 0;
  closeCount = 0;
  readonly #queue: StudioState[];

  constructor(states: StudioState[] = []) {
    this.#queue = [...states];
  }

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

  poll(): StudioState | null {
    if (!this.#open) throw new Error('poll() before open()');
    return this.#queue.shift() ?? null;
  }
}

/** Hardware-free speech sink that records what was spoken. */
export class RecordingSpeechSink implements SpeechSink {
  #open = false;
  openCount = 0;
  closeCount = 0;
  readonly spoken: Utterance[] = [];

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

  speak(utterance: Utterance): void {
    if (!this.#open) throw new Error('speak() before open()');
    this.spoken.push(utterance);
  }
}
