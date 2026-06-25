/**
 * Workflow automation for Creative Studio.
 *
 * "Automating steps" for a creative app = replaying a named macro of input actions
 * (keyboard shortcuts, pointer clicks). Per contract rule 4 this service NEVER
 * drives the pointer/keyboard directly: each step is emitted as an `input/intent`
 * event and the shared input multiplexer serializes it before it reaches the OS.
 *
 * Modelled on `clawpilot`'s Command queue: one workflow runs at a time, every step
 * is audited, and the runner refuses to start a second concurrent run.
 */

/** A single automatable action, mapped 1:1 to an `input/intent` payload. */
export interface StudioAction {
  kind: 'cursor' | 'keyboard';
  /** Action-specific data, e.g. `{ keys: 'Ctrl+Shift+E' }` or `{ click: 'export' }`. */
  payload: Record<string, unknown>;
  /** Short narratable description, e.g. `'open export dialog'`. */
  describe: string;
}

/** A named macro: an ordered list of actions to replay. */
export interface Workflow {
  id: string;
  title: string;
  steps: StudioAction[];
}

/** Sink the runner needs: emit an intent through the mux, and audit. */
export interface WorkflowContext {
  /** Emit one input intent onto the bus (the mux picks it up). */
  emit(kind: 'cursor' | 'keyboard', payload: Record<string, unknown>): void;
  /** Append-only audit / progress sink (also used to narrate progress). */
  audit(entry: string): void;
}

/** Result of attempting to run a workflow. */
export interface WorkflowResult {
  id: string;
  /** `false` when refused because another workflow was already running. */
  ran: boolean;
  /** Number of steps emitted. */
  steps: number;
}

/**
 * Holds the registered workflows and replays them one at a time. Keeps no OS
 * handles — it only emits intents, so there is nothing to release on disable beyond
 * refusing further runs.
 */
export class WorkflowRunner {
  readonly #workflows = new Map<string, Workflow>();
  #running: string | null = null;

  constructor(
    private readonly ctx: WorkflowContext,
    workflows: Workflow[] = defaultWorkflows(),
  ) {
    for (const w of workflows) this.#workflows.set(w.id, w);
  }

  /** Ids of the registered workflows. */
  list(): string[] {
    return [...this.#workflows.keys()];
  }

  get running(): string | null {
    return this.#running;
  }

  /**
   * Replay a workflow's steps as input intents. Serialized: if one is already
   * running, the request is refused (`ran: false`) rather than interleaving input.
   * Throws on an unknown id so callers surface a real error.
   */
  async run(id: string): Promise<WorkflowResult> {
    const workflow = this.#workflows.get(id);
    if (!workflow) throw new Error(`unknown workflow: ${id}`);
    if (this.#running) return { id, ran: false, steps: 0 };

    this.#running = id;
    try {
      this.ctx.audit(`workflow start ${id}`);
      for (const step of workflow.steps) {
        this.ctx.audit(`step ${step.describe}`);
        this.ctx.emit(step.kind, { ...step.payload, source: 'creative-studio' });
      }
      this.ctx.audit(`workflow done ${id}`);
      return { id, ran: true, steps: workflow.steps.length };
    } finally {
      this.#running = null;
    }
  }
}

/** A small starter set of generic creative-app macros. */
export function defaultWorkflows(): Workflow[] {
  return [
    {
      id: 'export-png',
      title: 'Export as PNG',
      steps: [
        { kind: 'keyboard', payload: { keys: 'Ctrl+Shift+E' }, describe: 'open export dialog' },
        { kind: 'keyboard', payload: { keys: 'Enter' }, describe: 'confirm export' },
      ],
    },
    {
      id: 'save',
      title: 'Save document',
      steps: [{ kind: 'keyboard', payload: { keys: 'Ctrl+S' }, describe: 'save' }],
    },
    {
      id: 'undo',
      title: 'Undo last action',
      steps: [{ kind: 'keyboard', payload: { keys: 'Ctrl+Z' }, describe: 'undo' }],
    },
  ];
}
