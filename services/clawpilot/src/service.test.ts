import { describe, expect, it } from 'vitest';
import type { EventBus, EventPayload, EventTopic, ServiceContext } from '@aah/contracts';
import { ClawPilotMcpAdapter, type ClawPilotSession } from '@aah/clawpilot-mcp-adapter';
import { ClawPilotService } from './service.js';

class FakeBus implements EventBus {
  readonly emitted: Array<{ topic: EventTopic; payload: unknown }> = [];
  readonly #handlers = new Map<EventTopic, Array<(payload: unknown) => void>>();

  emit<T extends EventTopic>(topic: T, payload: EventPayload<T>): void {
    this.emitted.push({ topic, payload });
    for (const handler of this.#handlers.get(topic) ?? []) {
      handler(payload);
    }
  }

  on<T extends EventTopic>(topic: T, handler: (payload: EventPayload<T>) => void): () => void {
    const list = this.#handlers.get(topic) ?? [];
    list.push(handler as (payload: unknown) => void);
    this.#handlers.set(topic, list);
    return () => this.off(topic, handler);
  }

  off<T extends EventTopic>(topic: T, handler: (payload: EventPayload<T>) => void): void {
    const list = this.#handlers.get(topic) ?? [];
    this.#handlers.set(
      topic,
      list.filter((candidate) => candidate !== (handler as (payload: unknown) => void)),
    );
  }
}

class FakeSession implements ClawPilotSession {
  readonly sent: Array<{ instruction: string; context?: Record<string, unknown> }> = [];
  closed = false;

  async send(instruction: string, context?: Record<string, unknown>): Promise<void> {
    this.sent.push({ instruction, context });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeAdapter {
  connectCount = 0;
  constructor(private readonly session: FakeSession) {}

  async connect(): Promise<ClawPilotSession> {
    this.connectCount += 1;
    return this.session;
  }
}

function makeCtx(bus: EventBus): ServiceContext {
  const store = new Map<string, unknown>();
  return {
    selfId: 'clawpilot',
    bus,
    config: {
      get<T = unknown>(key: string): T | undefined {
        return store.get(key) as T | undefined;
      },
      set<T = unknown>(key: string, value: T): void {
        store.set(key, value);
      },
    },
  };
}

describe('ClawPilotService context integration', () => {
  it('connects on enable and reports connected health', async () => {
    const bus = new FakeBus();
    const session = new FakeSession();
    const adapter = new FakeAdapter(session);
    const svc = new ClawPilotService({ adapter: adapter as unknown as ClawPilotMcpAdapter });

    await svc.onLoad(makeCtx(bus));
    await svc.onEnable();

    expect(adapter.connectCount).toBe(1);
    expect(svc.healthCheck().detail).toBe('clawpilot connected');
  });

  it('forwards input/context payload and context to MCP session', async () => {
    const bus = new FakeBus();
    const session = new FakeSession();
    const adapter = new FakeAdapter(session);
    const svc = new ClawPilotService({ adapter: adapter as unknown as ClawPilotMcpAdapter });

    await svc.onLoad(makeCtx(bus));
    await svc.onEnable();

    bus.emit('input/context', {
      source: 'gaze-correlation',
      kind: 'cursor',
      payload: { action: 'click', target: 'center' },
      context: { hints: { region: 'center' } },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(session.sent).toHaveLength(1);
    expect(session.sent[0].instruction).toContain('"action":"click"');
    expect(session.sent[0].context).toEqual({ hints: { region: 'center' } });
  });

  it('closes session on disable/unload', async () => {
    const bus = new FakeBus();
    const session = new FakeSession();
    const adapter = new FakeAdapter(session);
    const svc = new ClawPilotService({ adapter: adapter as unknown as ClawPilotMcpAdapter });

    await svc.onLoad(makeCtx(bus));
    await svc.onEnable();
    await svc.onDisable();

    expect(session.closed).toBe(true);
    expect(svc.healthCheck().detail).toBe('clawpilot idle');

    await svc.onUnload();
    expect(svc.healthCheck().state).toBe('degraded');
  });
});
