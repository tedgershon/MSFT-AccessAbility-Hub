/**
 * Mode State Machine — clean handoffs between competing input modes on a channel.
 *
 * Example: gaze vs. voice both want to be the input source. The machine governs the
 * live handoff (`GAZE_ACTIVE <-> VOICE_ACTIVE`), granting the exclusive lease to
 * whichever mode is foregrounded. Generic over the candidate mode ids.
 */

export interface ModeTransition {
  from: string;
  to: string;
  at: number;
}

/**
 * A tiny finite-state machine over a fixed set of mode ids on one channel.
 * Exactly one mode is active at a time; switching is an explicit transition.
 */
export class ModeStateMachine {
  #active: string;
  readonly #modes: ReadonlySet<string>;
  readonly #history: ModeTransition[] = [];

  constructor(
    public readonly channel: string,
    modes: readonly string[],
    initial: string,
  ) {
    if (modes.length === 0) throw new Error('A mode machine needs at least one mode.');
    if (!modes.includes(initial)) {
      throw new Error(`Initial mode "${initial}" is not in [${modes.join(', ')}].`);
    }
    this.#modes = new Set(modes);
    this.#active = initial;
  }

  get active(): string {
    return this.#active;
  }

  get modes(): string[] {
    return [...this.#modes];
  }

  /** Switch the foregrounded mode. No-op (but recorded) if already active. */
  switchTo(mode: string): ModeTransition {
    if (!this.#modes.has(mode)) {
      throw new Error(`Mode "${mode}" is not registered on channel "${this.channel}".`);
    }
    const transition: ModeTransition = { from: this.#active, to: mode, at: Date.now() };
    this.#active = mode;
    this.#history.push(transition);
    return transition;
  }

  history(): ModeTransition[] {
    return [...this.#history];
  }
}
