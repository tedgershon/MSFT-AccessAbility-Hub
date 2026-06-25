/**
 * ClawPilot MCP Adapter.
 *
 * ClawPilot is a standalone desktop agent (built on OpenClaw), not an in-process
 * lib. This adapter is the only thing that knows the MCP transport details; the
 * rest of the hub talks to it through this narrow, contract-shaped surface
 * (Adapter pattern + least privilege).
 *
 * The hub stays INDEPENDENT of ClawPilot: it is never bundled, never required to
 * launch the hub, and the adapter degrades to "unavailable" rather than throwing
 * when no agent is installed. We are an MCP *client* — either spawning a locally
 * installed agent over stdio, or dialing an already-running MCP endpoint.
 */

import { spawn } from 'node:child_process';
import {
  type AgentClient,
  type AgentClientFactory,
  type AgentConnection,
  ClawPilotUnavailableError,
} from './agent-client.js';
import { McpAgentClient } from './mcp-agent-client.js';

export {
  type AgentClient,
  type AgentClientFactory,
  type AgentConnection,
  ClawPilotUnavailableError,
} from './agent-client.js';
export { McpAgentClient } from './mcp-agent-client.js';

/** Default computer-use tool invoked on the agent. */
export const DEFAULT_TOOL_NAME = 'computer_use';

export interface ClawPilotSession {
  /** Send a computer-use instruction to the external agent. */
  send(instruction: string): Promise<void>;
  close(): Promise<void>;
}

/** Options shared by both connection modes. */
interface CommonAdapterOptions {
  /** Computer-use tool to call on the agent. Default: {@link DEFAULT_TOOL_NAME}. */
  toolName?: string;
  /** Inject a fake {@link AgentClient} factory (tests). Default: real MCP backend. */
  clientFactory?: AgentClientFactory;
}

/** Spawn a locally-installed agent and speak stdio MCP to it. */
export interface SpawnAdapterOptions extends CommonAdapterOptions {
  command: string;
  args?: string[];
  cwd?: string;
}

/** Connect to an already-running MCP server. */
export interface EndpointAdapterOptions extends CommonAdapterOptions {
  /** Command/URL used to reach the external ClawPilot MCP server. */
  endpoint: string;
}

export type ClawPilotAdapterOptions = SpawnAdapterOptions | EndpointAdapterOptions;

function isEndpointMode(
  opts: ClawPilotAdapterOptions,
): opts is EndpointAdapterOptions {
  return 'endpoint' in opts && typeof opts.endpoint === 'string';
}

/**
 * Best-effort, non-throwing PATH lookup for a command. Cross-platform: uses
 * `where` on Windows and `which` elsewhere. Resolves `false` on any error so a
 * missing agent never crashes availability detection.
 */
function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    try {
      const child = spawn(probe, [command], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

/** A {@link ClawPilotSession} that forwards instructions to an {@link AgentClient}. */
class AgentSession implements ClawPilotSession {
  constructor(
    private readonly client: AgentClient,
    private readonly toolName: string,
  ) {}

  async send(instruction: string): Promise<void> {
    await this.client.callTool(this.toolName, { instruction });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

const defaultClientFactory: AgentClientFactory = (connection) =>
  new McpAgentClient(connection);

export class ClawPilotMcpAdapter {
  constructor(private readonly opts: ClawPilotAdapterOptions) {}

  /**
   * Detect whether the external agent is reachable **without** connecting.
   * - endpoint mode: true when a non-empty endpoint is configured.
   * - spawn mode: true when `command` resolves on PATH. Non-throwing.
   */
  async isAvailable(): Promise<boolean> {
    if (isEndpointMode(this.opts)) {
      return this.opts.endpoint.trim().length > 0;
    }
    if (!this.opts.command.trim()) return false;
    return commandExists(this.opts.command);
  }

  /**
   * Build the {@link AgentClient}, connect, and hand back a session. Throws
   * {@link ClawPilotUnavailableError} on failure so callers can catch + degrade.
   */
  async connect(): Promise<ClawPilotSession> {
    const factory = this.opts.clientFactory ?? defaultClientFactory;
    const client = factory(this.#connection());
    try {
      await client.connect();
    } catch (err) {
      if (err instanceof ClawPilotUnavailableError) throw err;
      throw new ClawPilotUnavailableError(
        'failed to connect to the ClawPilot agent',
        { cause: err },
      );
    }
    return new AgentSession(client, this.opts.toolName ?? DEFAULT_TOOL_NAME);
  }

  #connection(): AgentConnection {
    if (isEndpointMode(this.opts)) {
      return { mode: 'endpoint', endpoint: this.opts.endpoint };
    }
    return {
      mode: 'spawn',
      command: this.opts.command,
      args: this.opts.args ?? [],
      cwd: this.opts.cwd,
    };
  }
}
