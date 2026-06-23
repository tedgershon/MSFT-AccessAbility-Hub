/**
 * Mode Coordinator — Mediator.
 *
 * Centralizes inter-service negotiation for *semantic / control* conflicts: when
 * two services both want to DRIVE the same channel (e.g. gaze vs. voice as input).
 *
 * Flow: Arbiter detects an exclusive collision on a control channel → Coordinator
 * registers the candidates in an arbitrated mode, surfaces a mode-switch affordance
 * in the shell, and a {@link ModeStateMachine} governs the live handoff.
 */

import type { EventBus } from '@aah/contracts';
import { ModeStateMachine } from './mode-state-machine.js';

export class ModeCoordinator {
  readonly #machines = new Map<string, ModeStateMachine>();

  constructor(private readonly bus: EventBus) {}

  /**
   * Put a channel under arbitration with a set of candidate services/modes.
   * Idempotent per channel; surfaces a mode-switch request to the shell.
   */
  arbitrate(channel: string, candidates: readonly string[], initial?: string): void {
    if (!this.#machines.has(channel)) {
      this.#machines.set(
        channel,
        new ModeStateMachine(channel, candidates, initial ?? candidates[0]),
      );
    }
    this.bus.emit('coordinator/mode-switch-requested', {
      channel,
      candidates: [...candidates],
    });
  }

  /** Foreground a mode on a channel; emits the change for the shell + arbiter. */
  switchTo(channel: string, mode: string): void {
    const machine = this.#machines.get(channel);
    if (!machine) throw new Error(`Channel "${channel}" is not under arbitration.`);
    machine.switchTo(mode);
    this.bus.emit('coordinator/mode-changed', { channel, activeServiceId: mode });
  }

  activeOn(channel: string): string | undefined {
    return this.#machines.get(channel)?.active;
  }

  channels(): string[] {
    return [...this.#machines.keys()];
  }
}
