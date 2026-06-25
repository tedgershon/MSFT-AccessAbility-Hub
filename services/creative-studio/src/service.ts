/**
 * Creative Studio service — issue #29, blind & low-vision support tile.
 *
 * Mediates a creative app for a blind / low-vision user: it *narrates* salient state
 * changes (active tool, selection, layer, zoom, dialogs, status) and *automates*
 * multi-step workflows on request. Two contended seams are held while enabled:
 *
 *   - `commandChannel` (shared): reads creative-app / screen state — released in onDisable.
 *   - `audioOut`       (shared): speaks narration                  — released in onDisable.
 *
 * Automation never touches the OS directly: each step is published as an
 * `input/intent` event so the shared input multiplexer serializes it (rule 4); the
 * service therefore also declares `cursor`/`keyboard` (shared).
 *
 * Composition over inheritance: narration lives in {@link Narrator}, automation in
 * {@link WorkflowRunner}, and the device seams behind {@link StudioChannel} /
 * {@link SpeechSink} — the service is just the lifecycle shell that wires them.
 */

import {
  type AccessibilityService,
  type Capability,
  cap,
  degraded,
  type HealthStatus,
  healthy,
  type ServiceContext,
  type ServiceMeta,
} from '@aah/contracts';
import {
  RecordingSpeechSink,
  ScriptedStudioChannel,
  type SpeechSink,
  type StudioChannel,
} from './channel.js';
import { emptyState, Narrator, type StudioState, type Utterance } from './narration.js';
import { WorkflowRunner, type WorkflowResult } from './workflow.js';

export interface CreativeStudioDeps {
  channel?: StudioChannel;
  speech?: SpeechSink;
  narrator?: Narrator;
}

export class CreativeStudioService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'creative-studio',
    name: 'Creative Studio',
    version: '0.1.0',
  };

  // Read screen state (commandChannel), narrate (audioOut), and automate steps via
  // the input mux (cursor/keyboard). All shared — we cooperate with the user.
  readonly requires: Capability[] = [
    cap('commandChannel', 'shared'),
    cap('audioOut', 'shared'),
    cap('cursor', 'shared'),
    cap('keyboard', 'shared'),
  ];

  readonly #channel: StudioChannel;
  readonly #speech: SpeechSink;
  readonly #narrator: Narrator;

  #ctx?: ServiceContext;
  #runner?: WorkflowRunner;
  #active = false;
  #prev: StudioState = emptyState();

  constructor(deps: CreativeStudioDeps = {}) {
    // Defaults keep the service hardware-free until real adapters are wired in.
    this.#channel = deps.channel ?? new ScriptedStudioChannel();
    this.#speech = deps.speech ?? new RecordingSpeechSink();
    this.#narrator = deps.narrator ?? new Narrator();
  }

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    // Automation routes every step through the input multiplexer (rule 4) and
    // narrates progress through the same audio sink.
    this.#runner = new WorkflowRunner({
      emit: (kind, payload) => ctx.bus.emit('input/intent', { source: this.meta.id, kind, payload }),
      audit: (entry) => this.#say({ source: 'workflow', text: entry, urgency: 'polite' }),
    });
  }

  async onEnable(): Promise<void> {
    if (!this.#ctx) return;
    // Acquire both leases and reset the narration baseline.
    this.#channel.open();
    this.#speech.open();
    this.#prev = emptyState();
    this.#active = true;
  }

  async onDisable(): Promise<void> {
    // Release the commandChannel + audioOut leases (rule 5 generalised: release
    // every lease on disable), even if enable half-failed.
    this.#active = false;
    this.#channel.close();
    this.#speech.close();
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
    this.#runner = undefined;
  }

  /**
   * Poll the channel once and narrate any state change. Driven by the host loop;
   * a method so tests can step it deterministically. Returns what was spoken.
   */
  tick(): Utterance[] {
    if (!this.#active) return [];
    const next = this.#channel.poll();
    if (!next) return [];
    const utterances = this.#narrator.narrate(this.#prev, next);
    this.#prev = next;
    for (const u of utterances) this.#say(u);
    return utterances;
  }

  /** Run a named automation workflow. Returns the result (or refusal). */
  async runWorkflow(id: string): Promise<WorkflowResult> {
    if (!this.#active || !this.#runner) return { id, ran: false, steps: 0 };
    return this.#runner.run(id);
  }

  /** Workflow ids available to the user. */
  workflows(): string[] {
    return this.#runner?.list() ?? [];
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx || !this.#runner) return degraded('not loaded');
    if (this.#active && (!this.#channel.isOpen || !this.#speech.isOpen)) {
      return degraded('studio lease lost');
    }
    return healthy(this.#active ? 'mediating' : 'idle');
  }

  #say(utterance: Utterance): void {
    if (this.#speech.isOpen) this.#speech.speak(utterance);
  }
}
