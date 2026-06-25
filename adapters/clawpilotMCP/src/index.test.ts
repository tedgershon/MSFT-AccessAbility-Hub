/**
 * Unit tests for the ClawPilot MCP adapter.
 *
 * Everything runs against an INJECTED fake {@link AgentClient} (via `clientFactory`),
 * so these tests need neither the MCP SDK nor a running ClawPilot agent. The real
 * SDK backend ({@link McpAgentClient}) is never touched here.
 */

import { describe, expect, it } from 'vitest';
import {
  type AgentClient,
  type AgentClientFactory,
  type AgentConnection,
  ClawPilotMcpAdapter,
  ClawPilotUnavailableError,
  DEFAULT_TOOL_NAME,
} from './index.js';

interface FakeClientOptions {
  /** Make connect() reject to exercise the degrade path. */
  failConnect?: boolean;
}

class FakeAgentClient implements AgentClient {
  connected = false;
  closed = false;
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(
    readonly connection: AgentConnection,
    private readonly opts: FakeClientOptions = {},
  ) {}

  async connect(): Promise<void> {
    if (this.opts.failConnect) throw new Error('boom: agent not reachable');
    this.connected = true;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args });
    return { ok: true };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function fakeFactory(
  opts: FakeClientOptions = {},
): { factory: AgentClientFactory; clients: FakeAgentClient[] } {
  const clients: FakeAgentClient[] = [];
  const factory: AgentClientFactory = (connection) => {
    const client = new FakeAgentClient(connection, opts);
    clients.push(client);
    return client;
  };
  return { factory, clients };
}

describe('ClawPilotMcpAdapter.connect', () => {
  it('returns a session whose send() forwards to callTool(toolName, { instruction })', async () => {
    const { factory, clients } = fakeFactory();
    const adapter = new ClawPilotMcpAdapter({
      endpoint: 'http://localhost:9000/mcp',
      clientFactory: factory,
    });

    const session = await adapter.connect();
    await session.send('open the start menu');

    expect(clients).toHaveLength(1);
    expect(clients[0].connected).toBe(true);
    expect(clients[0].calls).toEqual([
      { name: DEFAULT_TOOL_NAME, args: { instruction: 'open the start menu' } },
    ]);
  });

  it('uses a custom toolName when provided', async () => {
    const { factory, clients } = fakeFactory();
    const adapter = new ClawPilotMcpAdapter({
      endpoint: 'http://localhost:9000/mcp',
      toolName: 'drive_computer',
      clientFactory: factory,
    });

    const session = await adapter.connect();
    await session.send('click ok');

    expect(clients[0].calls[0].name).toBe('drive_computer');
  });

  it('passes a spawn connection to the factory in spawn mode', async () => {
    const { factory, clients } = fakeFactory();
    const adapter = new ClawPilotMcpAdapter({
      command: 'clawpilot',
      args: ['--mcp'],
      cwd: '/tmp',
      clientFactory: factory,
    });

    await adapter.connect();

    expect(clients[0].connection).toEqual({
      mode: 'spawn',
      command: 'clawpilot',
      args: ['--mcp'],
      cwd: '/tmp',
    });
  });

  it('session.close() closes the underlying client', async () => {
    const { factory, clients } = fakeFactory();
    const adapter = new ClawPilotMcpAdapter({
      endpoint: 'http://localhost:9000/mcp',
      clientFactory: factory,
    });

    const session = await adapter.connect();
    await session.close();

    expect(clients[0].closed).toBe(true);
  });

  it('throws ClawPilotUnavailableError when the client cannot connect', async () => {
    const { factory } = fakeFactory({ failConnect: true });
    const adapter = new ClawPilotMcpAdapter({
      endpoint: 'http://localhost:9000/mcp',
      clientFactory: factory,
    });

    await expect(adapter.connect()).rejects.toBeInstanceOf(ClawPilotUnavailableError);
  });
});

describe('ClawPilotMcpAdapter.isAvailable', () => {
  it('is true in endpoint mode when an endpoint is configured', async () => {
    const adapter = new ClawPilotMcpAdapter({ endpoint: 'http://localhost:9000/mcp' });
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('is false in endpoint mode when the endpoint is blank', async () => {
    const adapter = new ClawPilotMcpAdapter({ endpoint: '   ' });
    expect(await adapter.isAvailable()).toBe(false);
  });

  it('is false in spawn mode when the command is a guaranteed-absent binary', async () => {
    const adapter = new ClawPilotMcpAdapter({
      command: 'definitely-not-a-real-binary-xyzzy-9000',
    });
    expect(await adapter.isAvailable()).toBe(false);
  });

  it('is true in spawn mode when the command resolves on PATH', async () => {
    // node itself is guaranteed present in CI; probe by its basename.
    const adapter = new ClawPilotMcpAdapter({ command: 'node' });
    expect(await adapter.isAvailable()).toBe(true);
  });
});
