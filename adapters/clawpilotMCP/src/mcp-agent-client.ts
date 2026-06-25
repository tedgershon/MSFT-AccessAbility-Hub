/**
 * Real {@link AgentClient} backed by the official Model Context Protocol SDK.
 *
 * The SDK is imported **lazily** inside {@link McpAgentClient.connect} via dynamic
 * `import()` so that merely loading this module never pulls in the SDK (mirrors the
 * guarded `sounddevice` backend in the audio adapter). Tests inject a fake client
 * and never reach this code, so they need neither the SDK nor a running agent.
 *
 * If the SDK import or the connection itself fails, we surface a
 * {@link ClawPilotUnavailableError} so the service layer can degrade gracefully.
 */

// Type-only import: erased at runtime (verbatimModuleSyntax), so it does NOT load
// the SDK at module-eval time. The actual code load happens in connect()'s import().
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  type AgentClient,
  type AgentConnection,
  ClawPilotUnavailableError,
} from './agent-client.js';

export class McpAgentClient implements AgentClient {
  #client?: Client;

  constructor(private readonly connection: AgentConnection) {}

  async connect(): Promise<void> {
    try {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const transport = await this.#transport();
      const client = new Client({
        name: 'aah-clawpilot-adapter',
        version: '0.1.0',
      });
      await client.connect(transport);
      this.#client = client;
    } catch (err) {
      this.#client = undefined;
      throw new ClawPilotUnavailableError(
        'failed to establish an MCP session with the ClawPilot agent',
        { cause: err },
      );
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.#client) {
      throw new ClawPilotUnavailableError('callTool invoked before connect()');
    }
    return this.#client.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    await client?.close();
  }

  /** Lazily build the SDK transport that matches the resolved connection mode. */
  async #transport(): Promise<
    Parameters<Client['connect']>[0]
  > {
    if (this.connection.mode === 'spawn') {
      const { StdioClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/stdio.js'
      );
      return new StdioClientTransport({
        command: this.connection.command,
        args: this.connection.args,
        cwd: this.connection.cwd,
      });
    }
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    );
    return new StreamableHTTPClientTransport(new URL(this.connection.endpoint));
  }
}
