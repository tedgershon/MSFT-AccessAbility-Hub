/**
 * ClawPilot MCP Adapter.
 *
 * ClawPilot is a standalone desktop agent (built on OpenClaw), not an in-process
 * lib. This adapter is the only thing that knows the MCP transport details; the
 * rest of the hub talks to it through this narrow, contract-shaped surface
 * (Adapter pattern + least privilege).
 */

export interface ClawPilotSession {
  /** Send a computer-use instruction to the external agent. */
  send(instruction: string, context?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

export interface ClawPilotAdapterOptions {
  /** Command/URL used to reach the external ClawPilot MCP server. */
  endpoint: string;
}

export class ClawPilotMcpAdapter {
  constructor(private readonly opts: ClawPilotAdapterOptions) {}

  async connect(): Promise<ClawPilotSession> {
    // TODO: establish the MCP session against this.opts.endpoint.
    void this.opts;
    return {
      async send(): Promise<void> {
        // TODO: forward over MCP.
      },
      async close(): Promise<void> {
        // TODO: tear down the MCP session.
      },
    };
  }
}
