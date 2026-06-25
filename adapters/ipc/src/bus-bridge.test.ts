import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '@aah/kernel';
import { BusBridge } from './bus-bridge.js';
import type { Frame } from './frame.js';
import { createChannelPair } from './in-memory-channel.js';

function collectChild(channel: ReturnType<typeof createChannelPair>['child']): Frame[] {
  const seen: Frame[] = [];
  channel.onMessage((f) => seen.push(f));
  return seen;
}

describe('BusBridge', () => {
  it('forwards a whitelisted bus event to the channel as an event frame', () => {
    const bus = new InMemoryEventBus();
    const { host, child } = createChannelPair();
    const childFrames = collectChild(child);

    const bridge = new BusBridge(bus, host, { forward: ['input/intent'] });
    bridge.mount();

    const payload = { source: 'ts', kind: 'keyboard' as const, payload: { command: 'x' } };
    bus.emit('input/intent', payload);

    expect(childFrames).toEqual([{ kind: 'event', topic: 'input/intent', payload }]);
    bridge.dispose();
  });

  it('does NOT forward topics outside the whitelist', () => {
    const bus = new InMemoryEventBus();
    const { host, child } = createChannelPair();
    const childFrames = collectChild(child);

    const bridge = new BusBridge(bus, host, { forward: ['input/intent'] });
    bridge.mount();

    bus.emit('service/health', { serviceId: 's', status: { state: 'healthy', checkedAt: 1 } });

    expect(childFrames).toEqual([]);
    bridge.dispose();
  });

  it('re-emits an inbound event frame on the real bus', () => {
    const bus = new InMemoryEventBus();
    const { host, child } = createChannelPair();

    const received: unknown[] = [];
    bus.on('input/intent', (p) => received.push(p));

    const bridge = new BusBridge(bus, host, { forward: ['input/intent'] });
    bridge.mount();

    const payload = { source: 'py', kind: 'keyboard' as const, payload: { command: 'go' } };
    child.send({ kind: 'event', topic: 'input/intent', payload });

    expect(received).toEqual([payload]);
    bridge.dispose();
  });

  it('echo-guard: a child-originated event is not sent back out to the channel', () => {
    const bus = new InMemoryEventBus();
    const { host, child } = createChannelPair();
    const childFrames = collectChild(child);

    const bridge = new BusBridge(bus, host, { forward: ['input/intent'] });
    bridge.mount();

    const payload = { source: 'py', kind: 'keyboard' as const, payload: { command: 'go' } };
    // Inbound from the child -> bridge re-emits on the bus. The forward subscriber
    // must NOT push it back out (no echo), so the child sees no new frames.
    child.send({ kind: 'event', topic: 'input/intent', payload });

    expect(childFrames).toEqual([]);
    bridge.dispose();
  });

  it('still forwards a locally-originated event after handling an inbound one', () => {
    const bus = new InMemoryEventBus();
    const { host, child } = createChannelPair();
    const childFrames = collectChild(child);

    const bridge = new BusBridge(bus, host, { forward: ['input/intent'] });
    bridge.mount();

    const inbound = { source: 'py', kind: 'keyboard' as const, payload: { command: 'in' } };
    child.send({ kind: 'event', topic: 'input/intent', payload: inbound });

    const local = { source: 'ts', kind: 'keyboard' as const, payload: { command: 'out' } };
    bus.emit('input/intent', local);

    // Only the locally-originated event crosses the seam.
    expect(childFrames).toEqual([{ kind: 'event', topic: 'input/intent', payload: local }]);
    bridge.dispose();
  });

  it('dispose() stops forwarding', () => {
    const bus = new InMemoryEventBus();
    const { host, child } = createChannelPair();
    const childFrames = collectChild(child);

    const bridge = new BusBridge(bus, host, { forward: ['input/intent'] });
    bridge.mount();
    bridge.dispose();

    bus.emit('input/intent', { source: 'ts', kind: 'keyboard', payload: {} });
    expect(childFrames).toEqual([]);
  });
});
