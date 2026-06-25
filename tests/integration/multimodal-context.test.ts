import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../core/kernel/src/event-bus.js';
import type { ServiceContext } from '../../core/contracts/src/service.js';
import type { ClawPilotSession } from '../../adapters/clawpilotMCP/src/index.js';
import { ClawPilotService } from '../../services/clawpilot/src/service.js';

class FakeSession implements ClawPilotSession {
  readonly sent: Array<{ instruction: string; context?: Record<string, unknown> }> = [];

  async send(instruction: string, context?: Record<string, unknown>): Promise<void> {
    this.sent.push({ instruction, context });
  }

  async close(): Promise<void> {
    // no-op
  }
}

class FakeAdapter {
  constructor(private readonly session: ClawPilotSession) {}

  async connect(): Promise<ClawPilotSession> {
    return this.session;
  }
}

function makeCtx(bus: InMemoryEventBus): ServiceContext {
  const config = new Map<string, unknown>();
  return {
    selfId: 'clawpilot',
    bus,
    config: {
      get<T = unknown>(key: string): T | undefined {
        return config.get(key) as T | undefined;
      },
      set<T = unknown>(key: string, value: T): void {
        config.set(key, value);
      },
    },
  };
}

describe('Integration: multimodal context to clawpilot', () => {
  it('forwards input/context payload + context to MCP session', async () => {
    const bus = new InMemoryEventBus();
    const session = new FakeSession();
    const svc = new ClawPilotService({ adapter: new FakeAdapter(session) as never });

    const audits: unknown[] = [];
    bus.on('input/intent', (payload) => audits.push(payload));

    await svc.onLoad(makeCtx(bus));
    await svc.onEnable();

    bus.emit('input/context', {
      source: 'gaze-correlation',
      kind: 'cursor',
      payload: { action: 'click', target: 'center' },
      context: {
        gaze: {
          sourceServiceId: 'gaze-correlation',
          capturedAtMs: 10,
          x: 100,
          y: 200,
          confidence: 0.8,
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(session.sent).toHaveLength(1);
    expect(session.sent[0].instruction).toContain('"action":"click"');
    expect(session.sent[0].context).toEqual({
      gaze: {
        sourceServiceId: 'gaze-correlation',
        capturedAtMs: 10,
        x: 100,
        y: 200,
        confidence: 0.8,
      },
    });
    expect(audits.length).toBeGreaterThan(0);

    await svc.onDisable();
    await svc.onUnload();
  });
});
