/**
 * ClawPilot computer-use service.
 *
 * ClawPilot is a standalone desktop agent (built on OpenClaw), NOT an in-process
 * library — it is reached via an MCP server + skills and wrapped behind the
 * clawpilotMCP adapter. This class is the kernel-facing contract; it declares the
 * heavy privileges it needs (`cursor`/`keyboard` exclusive, `browser` shared) and
 * routes all actions through a {@link CommandQueue} for queue/undo/audit.
 *
 * The hub stays INDEPENDENT of ClawPilot: the agent is optional and externally
 * installed. If it is absent or unreachable, this service degrades gracefully
 * (it never throws out of `onEnable`) so the rest of the hub keeps running.
 *
 * NOTE on the exclusive cursor/keyboard lease: ClawPilot drives the OS *itself*,
 * externally. We hold the exclusive cursor/keyboard lease purely to BLOCK other
 * hub injectors while it is active (contract rule 5) — we do NOT route ClawPilot's
 * own actions through our input multiplexer.
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
  type AgentClientFactory,
  ClawPilotMcpAdapter,
  type ClawPilotSession,
  ClawPilotUnavailableError,
} from '@aah/clawpilot-mcp-adapter';
import { type Command, CommandQueue, type CommandContext } from './command.js';

/** A queued action that forwards one instruction to the external agent. */
function forwardInstructionCommand(
  session: ClawPilotSession,
  instruction: string,
): Command {
  return {
    kind: `forward:${instruction}`,
    async execute(): Promise<void> {
      await session.send(instruction);
    },
  };
}

export class ClawPilotService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'clawpilot',
    name: 'ClawPilot Computer-Use',
    version: '0.1.0',
  };

  // High privilege — gate and sandbox aggressively (least privilege). The
  // exclusive cursor/keyboard lease blocks other hub injectors while ClawPilot
  // drives the OS externally; it does not mean we inject on its behalf.
  readonly requires: Capability[] = [
    cap('cursor', 'exclusive'),
    cap('keyboard', 'exclusive'),
    cap('browser', 'shared'),
  ];

  #ctx?: ServiceContext;
  #queue?: CommandQueue;
  #adapter?: ClawPilotMcpAdapter;
  #session?: ClawPilotSession;
  #enabled = false;

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    const commandCtx: CommandContext = {
      audit: (entry) => ctx.bus.emit('input/intent', {
        source: this.meta.id,
        kind: 'cursor',
        payload: { audit: entry },
      }),
    };
    this.#queue = new CommandQueue(commandCtx);
    this.#adapter = this.#buildAdapter(ctx);
  }

  async onEnable(): Promise<void> {
    this.#enabled = true;
    this.#session = undefined;

    const adapter = this.#adapter;
    if (!adapter) return; // not configured — stay degraded, never throw.

    // Detection is cheap and non-throwing: if the agent is not installed/reachable
    // we degrade rather than crash the hub (hub independence).
    if (!(await adapter.isAvailable())) return;

    try {
      this.#session = await adapter.connect();
    } catch (err) {
      // connect() only surfaces ClawPilotUnavailableError; swallow it and degrade
      // so an absent/unreachable agent never throws out of the lifecycle.
      if (err instanceof ClawPilotUnavailableError) {
        this.#session = undefined;
        return;
      }
      throw err;
    }
  }

  async onDisable(): Promise<void> {
    this.#enabled = false;
    const session = this.#session;
    this.#session = undefined;
    // Lease release is handled by the kernel; we just close the MCP session.
    await session?.close();
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
    this.#queue = undefined;
    this.#adapter = undefined;
    this.#session = undefined;
    this.#enabled = false;
  }

  /**
   * Queue a computer-use instruction for the external agent. No-op (audited) when
   * no session is connected, so callers never need to special-case absence.
   */
  enqueueInstruction(instruction: string): void {
    if (!this.#session || !this.#queue) return;
    this.#queue.enqueue(forwardInstructionCommand(this.#session, instruction));
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx || !this.#queue) return degraded('not loaded');
    if (this.#session) return healthy('connected');
    if (this.#enabled) return degraded('ClawPilot agent unavailable');
    return degraded('idle');
  }

  /** Construct the adapter from config (spawn mode wins over endpoint mode). */
  #buildAdapter(ctx: ServiceContext): ClawPilotMcpAdapter | undefined {
    const command = ctx.config.get<string>('clawpilot.command');
    const endpoint = ctx.config.get<string>('clawpilot.endpoint');
    const toolName = ctx.config.get<string>('clawpilot.toolName');
    // Test hook: inject a fake AgentClient factory so suites never need the SDK.
    const clientFactory = ctx.config.get<AgentClientFactory>('clawpilot.clientFactory');

    if (command) {
      return new ClawPilotMcpAdapter({ command, toolName, clientFactory });
    }
    if (endpoint) {
      return new ClawPilotMcpAdapter({ endpoint, toolName, clientFactory });
    }
    return undefined;
  }
}
