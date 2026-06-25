/**
 * ClawPilot computer-use service.
 *
 * ClawPilot is a standalone desktop agent (built on OpenClaw), NOT an in-process
 * library — it is reached via an MCP server + skills and wrapped behind the
 * clawpilotMCP adapter. This class is the kernel-facing contract; it declares the
 * heavy privileges it needs (`cursor`/`keyboard` exclusive, `browser` shared) and
 * routes all actions through a {@link CommandQueue} for queue/undo/audit.
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
import { ClawPilotMcpAdapter, type ClawPilotSession } from '@aah/clawpilot-mcp-adapter';
import type { Command } from './command.js';
import { CommandQueue, type CommandContext } from './command.js';

class RemoteInstructionCommand implements Command {
  readonly kind = 'remote-instruction';

  constructor(
    private readonly instruction: string,
    private readonly context?: Record<string, unknown>,
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    await ctx.sendInstruction(this.instruction, this.context);
  }
}

export class ClawPilotService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'clawpilot',
    name: 'ClawPilot Computer-Use',
    version: '0.1.0',
  };

  // High privilege — gate and sandbox aggressively (least privilege).
  readonly requires: Capability[] = [
    cap('cursor', 'exclusive'),
    cap('keyboard', 'exclusive'),
    cap('browser', 'shared'),
  ];

  #ctx?: ServiceContext;
  #queue?: CommandQueue;
  #offInputContext?: () => void;
  #session?: ClawPilotSession;
  readonly #adapter?: ClawPilotMcpAdapter;
  readonly #defaultEndpoint: string;

  constructor(options: { adapter?: ClawPilotMcpAdapter; endpoint?: string } = {}) {
    this.#adapter = options.adapter;
    this.#defaultEndpoint = options.endpoint ?? 'ws://localhost:8765';
  }

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    const commandCtx: CommandContext = {
      audit: (entry) => ctx.bus.emit('input/intent', {
        source: this.meta.id,
        kind: 'cursor',
        payload: { audit: entry },
      }),
      sendInstruction: async (instruction, context) => {
        if (!this.#session) {
          throw new Error('clawpilot session is not connected');
        }
        await this.#session.send(instruction, context);
      },
    };
    this.#queue = new CommandQueue(commandCtx);

    this.#offInputContext = ctx.bus.on('input/context', (intent) => {
      if (!this.#session || !this.#queue) return;
      const instruction =
        typeof intent.payload === 'string' ? intent.payload : JSON.stringify(intent.payload);
      this.#queue.enqueue(
        new RemoteInstructionCommand(
          instruction,
          intent.context as Record<string, unknown> | undefined,
        ),
      );
    });
  }

  async onEnable(): Promise<void> {
    if (!this.#ctx || this.#session) return;
    const endpoint = this.#ctx.config.get<string>('clawpilot.endpoint') ?? this.#defaultEndpoint;
    const adapter = this.#adapter ?? new ClawPilotMcpAdapter({ endpoint });
    this.#session = await adapter.connect();
  }

  async onDisable(): Promise<void> {
    if (this.#session) {
      await this.#session.close();
      this.#session = undefined;
    }
  }

  async onUnload(): Promise<void> {
    await this.onDisable();
    this.#offInputContext?.();
    this.#offInputContext = undefined;
    this.#ctx = undefined;
    this.#queue = undefined;
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx || !this.#queue) return degraded('not loaded');
    if (!this.#session) return healthy('clawpilot idle');
    return healthy('clawpilot connected');
  }
}
