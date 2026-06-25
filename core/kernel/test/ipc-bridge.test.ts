import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../src/event-bus.js';
import { IpcEventBridge, type BridgeMessage, type BridgeTransport } from '../src/ipc-bridge.js';

/** In-memory transport that records sent messages and lets a test push inbound ones. */
class FakeTransport implements BridgeTransport {
  readonly sent: BridgeMessage[] = [];
  #handler: ((message: BridgeMessage) => void) | undefined;
  closed = false;

  send(message: BridgeMessage): void {
    this.sent.push(message);
  }

  onMessage(handler: (message: BridgeMessage) => void): void {
    this.#handler = handler;
  }

  close(): void {
    this.closed = true;
  }

  /** Simulate a message arriving from the remote process. */
  receive(message: BridgeMessage): void {
    this.#handler?.(message);
  }
}

describe('IpcEventBridge', () => {
  it('forwards allowlisted bus events out to the transport', () => {
    const bus = new InMemoryEventBus();
    const transport = new FakeTransport();
    const bridge = new IpcEventBridge(bus, transport, {
      toTransport: ['display/frame-ref'],
      fromTransport: [],
    });
    bridge.start();

    const payload = { sourceServiceId: 'shell', capturedAtMs: 1, width: 1920, height: 1080 };
    bus.emit('display/frame-ref', payload);

    expect(transport.sent).toEqual([{ topic: 'display/frame-ref', payload }]);
  });

  it('does not forward topics outside the toTransport allowlist', () => {
    const bus = new InMemoryEventBus();
    const transport = new FakeTransport();
    const bridge = new IpcEventBridge(bus, transport, {
      toTransport: ['display/frame-ref'],
      fromTransport: [],
    });
    bridge.start();

    bus.emit('arbiter/lease-released', { serviceId: 'svc' });

    expect(transport.sent).toEqual([]);
  });

  it('re-emits allowlisted inbound messages onto the local bus', () => {
    const bus = new InMemoryEventBus();
    const transport = new FakeTransport();
    const handler = vi.fn();
    bus.on('gaze/point', handler);
    const bridge = new IpcEventBridge(bus, transport, {
      toTransport: [],
      fromTransport: ['gaze/point'],
    });
    bridge.start();

    const payload = { sourceServiceId: 'gaze-correlation', capturedAtMs: 2, x: 10, y: 20, confidence: 0.9 };
    transport.receive({ topic: 'gaze/point', payload });

    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('drops inbound messages outside the fromTransport allowlist', () => {
    const bus = new InMemoryEventBus();
    const transport = new FakeTransport();
    const handler = vi.fn();
    bus.on('gaze/point', handler);
    const bridge = new IpcEventBridge(bus, transport, {
      toTransport: [],
      fromTransport: ['display/frame-ref'],
    });
    bridge.start();

    transport.receive({
      topic: 'gaze/point',
      payload: { sourceServiceId: 'x', capturedAtMs: 1, x: 0, y: 0, confidence: 1 },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not echo an inbound message back out when a topic is bidirectional', () => {
    const bus = new InMemoryEventBus();
    const transport = new FakeTransport();
    const bridge = new IpcEventBridge(bus, transport, {
      toTransport: ['gaze/point'],
      fromTransport: ['gaze/point'],
    });
    bridge.start();

    transport.receive({
      topic: 'gaze/point',
      payload: { sourceServiceId: 'x', capturedAtMs: 1, x: 0, y: 0, confidence: 1 },
    });

    expect(transport.sent).toEqual([]);
  });

  it('stops forwarding and closes the transport on stop()', () => {
    const bus = new InMemoryEventBus();
    const transport = new FakeTransport();
    const bridge = new IpcEventBridge(bus, transport, {
      toTransport: ['display/frame-ref'],
      fromTransport: [],
    });
    bridge.start();
    bridge.stop();

    bus.emit('display/frame-ref', { sourceServiceId: 'shell', capturedAtMs: 1, width: 1, height: 1 });

    expect(transport.sent).toEqual([]);
    expect(transport.closed).toBe(true);
  });
});
