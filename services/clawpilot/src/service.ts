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
import { CommandQueue, type CommandContext } from './command.js';

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
  }

  async onEnable(): Promise<void> {
    // TODO: connect to the ClawPilot MCP server via the clawpilotMCP adapter.
  }

  async onDisable(): Promise<void> {
    // TODO: disconnect the MCP session and stop accepting commands.
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
    this.#queue = undefined;
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx || !this.#queue) return degraded('not loaded');
    return healthy('clawpilot idle');
  }
}
