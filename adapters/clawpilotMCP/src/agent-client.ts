/**
 * The narrow client abstraction the adapter talks to.
 *
 * The hub is deliberately INDEPENDENT of ClawPilot: ClawPilot is an external,
 * locally-installed agent reached over MCP, and we are merely an MCP *client*.
 * Everything that touches the real MCP SDK hides behind {@link AgentClient}, so the
 * adapter — and its tests — can run with a fake and never require the SDK or a
 * running agent (Dependency Inversion + least privilege).
 */

/** How to reach the external agent, resolved from the adapter options. */
export type AgentConnection =
  | { mode: 'spawn'; command: string; args: string[]; cwd?: string }
  | { mode: 'endpoint'; endpoint: string };

/**
 * Minimal transport-agnostic MCP client surface. The real implementation
 * ({@link McpAgentClient}) wraps the official SDK; tests inject a fake.
 */
export interface AgentClient {
  /** Establish the MCP session (spawn the agent or dial the endpoint). */
  connect(): Promise<void>;
  /** Invoke a tool exposed by the agent and return its raw result. */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Tear the session down. Safe to call when never connected. */
  close(): Promise<void>;
}

/** Builds an {@link AgentClient} for a resolved connection (overridable in tests). */
export type AgentClientFactory = (connection: AgentConnection) => AgentClient;

/**
 * Thrown when the external ClawPilot agent cannot be reached. The ClawPilot
 * service catches this to degrade gracefully — the hub must never crash just
 * because an optional, externally-installed agent is absent.
 */
export class ClawPilotUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ClawPilotUnavailableError';
  }
}
