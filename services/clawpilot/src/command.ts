/**
 * Command pattern: encapsulate each computer-use action so it can be queued,
 * audited, and (where possible) undone. Least privilege — every command is gated
 * and logged before it ever touches the input multiplexer.
 */

export interface CommandContext {
  /** Append-only audit sink. */
  audit(entry: string): void;
}

/** A single, reversible-where-possible computer action. */
export interface Command {
  readonly kind: string;
  execute(ctx: CommandContext): Promise<void>;
  undo?(ctx: CommandContext): Promise<void>;
}

/**
 * Serializes commands through one queue and keeps an undo stack + audit trail.
 * Actual injection is delegated to the shared input multiplexer (contract rule 4),
 * never performed directly here.
 */
export class CommandQueue {
  readonly #pending: Command[] = [];
  readonly #done: Command[] = [];
  #running = false;

  constructor(private readonly ctx: CommandContext) {}

  enqueue(command: Command): void {
    this.#pending.push(command);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#pending.length > 0) {
        const command = this.#pending.shift()!;
        this.ctx.audit(`execute ${command.kind}`);
        await command.execute(this.ctx);
        this.#done.push(command);
      }
    } finally {
      this.#running = false;
    }
  }

  async undoLast(): Promise<void> {
    const command = this.#done.pop();
    if (!command?.undo) return;
    this.ctx.audit(`undo ${command.kind}`);
    await command.undo(this.ctx);
  }
}
