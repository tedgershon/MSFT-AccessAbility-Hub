/**
 * Unit tests for the ClawPilot computer-use service.
 *
 * The service builds its adapter from config; we inject a fake `AgentClient`
 * factory through config so these tests need neither the MCP SDK nor a running
 * ClawPilot agent. A {@link CapturingBus} stands in for the kernel event bus.
 *
 * The key contract under test is GRACEFUL DEGRADATION: when the agent is absent
 * `onEnable` must resolve (never throw) and health must report degraded.
 */

import { describe, expect, it } from 'vitest';
import { type ConfigStore, type ServiceContext } from '@aah/contracts';
import { CapturingBus } from '@aah/test-fixtures';
import {
  type AgentClient,
  type AgentClientFactory,
  type AgentConnection,
} from '@aah/clawpilot-mcp-adapter';
import { ClawPilotService } from './service.js';

class FakeAgentClient implements AgentClient {
  connected = false;
  closed = false;
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(readonly connection: AgentConnection) {}

  async connect(): Promise<void> {
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

function fakeConfig(initial: Record<string, unknown> = {}): ConfigStore {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get<T = unknown>(key: string): T | undefined {
      return store.get(key) as T | undefined;
    },
    set<T = unknown>(key: string, value: T): void {
      store.set(key, value);
    },
  };
}

function makeCtx(config: ConfigStore): { ctx: ServiceContext; bus: CapturingBus } {
  const bus = new CapturingBus();
  const ctx: ServiceContext = { bus, config, selfId: 'clawpilot' };
  return { ctx, bus };
}

/** Config that makes the agent AVAILABLE: endpoint mode + a fake client factory. */
function availableConfig(): { config: ConfigStore; clients: FakeAgentClient[] } {
  const clients: FakeAgentClient[] = [];
  const factory: AgentClientFactory = (connection) => {
    const client = new FakeAgentClient(connection);
    clients.push(client);
    return client;
  };
  const config = fakeConfig({
    'clawpilot.endpoint': 'http://localhost:9000/mcp',
    'clawpilot.clientFactory': factory,
  });
  return { config, clients };
}

/** Let the CommandQueue drain its async work. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ClawPilotService graceful degradation', () => {
  it('connects and reports healthy when the agent is available', async () => {
    const { config, clients } = availableConfig();
    const { ctx } = makeCtx(config);
    const svc = new ClawPilotService();

    await svc.onLoad(ctx);
    await svc.onEnable();

    expect(clients).toHaveLength(1);
    expect(clients[0].connected).toBe(true);
    const health = svc.healthCheck();
    expect(health.state).toBe('healthy');
    expect(health.detail).toBe('connected');
  });

  it('does NOT throw and reports degraded when the agent is absent', async () => {
    const { ctx } = makeCtx(
      fakeConfig({ 'clawpilot.command': 'definitely-not-a-real-binary-xyzzy-9000' }),
    );
    const svc = new ClawPilotService();

    await svc.onLoad(ctx);
    // The whole point: an absent agent must not throw out of the lifecycle.
    await expect(svc.onEnable()).resolves.toBeUndefined();

    const health = svc.healthCheck();
    expect(health.state).toBe('degraded');
    expect(health.detail).toBe('ClawPilot agent unavailable');
  });

  it('stays degraded (idle) when no agent is configured at all', async () => {
    const { ctx } = makeCtx(fakeConfig());
    const svc = new ClawPilotService();

    await svc.onLoad(ctx);
    expect(svc.healthCheck().detail).toBe('idle');

    await expect(svc.onEnable()).resolves.toBeUndefined();
    expect(svc.healthCheck().detail).toBe('ClawPilot agent unavailable');
  });

  it('closes the session on disable and returns to idle', async () => {
    const { config, clients } = availableConfig();
    const { ctx } = makeCtx(config);
    const svc = new ClawPilotService();

    await svc.onLoad(ctx);
    await svc.onEnable();
    await svc.onDisable();

    expect(clients[0].closed).toBe(true);
    expect(svc.healthCheck().detail).toBe('idle');
  });

  it('forwards a queued instruction to the connected session', async () => {
    const { config, clients } = availableConfig();
    const { ctx } = makeCtx(config);
    const svc = new ClawPilotService();

    await svc.onLoad(ctx);
    await svc.onEnable();

    svc.enqueueInstruction('scroll down');
    await flush();

    expect(clients[0].calls).toEqual([
      { name: 'computer_use', args: { instruction: 'scroll down' } },
    ]);
  });

  it('healthCheck is degraded("not loaded") before onLoad', () => {
    const svc = new ClawPilotService();
    const health = svc.healthCheck();
    expect(health.state).toBe('degraded');
    expect(health.detail).toBe('not loaded');
  });
});
