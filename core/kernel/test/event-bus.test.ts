import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../src/event-bus.js';

describe('InMemoryEventBus', () => {
  it('delivers an emitted payload to every subscriber', () => {
    const bus = new InMemoryEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('arbiter/lease-released', a);
    bus.on('arbiter/lease-released', b);

    bus.emit('arbiter/lease-released', { serviceId: 'svc' });

    expect(a).toHaveBeenCalledWith({ serviceId: 'svc' });
    expect(b).toHaveBeenCalledWith({ serviceId: 'svc' });
  });

  it('only notifies subscribers of the matching topic', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.on('arbiter/lease-released', handler);

    bus.emit('arbiter/lease-denied', { serviceId: 'svc', conflictsWith: [] });

    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribes via the returned disposer', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const dispose = bus.on('arbiter/lease-released', handler);

    dispose();
    bus.emit('arbiter/lease-released', { serviceId: 'svc' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribes via off()', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.on('arbiter/lease-released', handler);

    bus.off('arbiter/lease-released', handler);
    bus.emit('arbiter/lease-released', { serviceId: 'svc' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('isolates a throwing subscriber so others still receive the event', () => {
    const bus = new InMemoryEventBus();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const boom = vi.fn(() => {
      throw new Error('handler exploded');
    });
    const after = vi.fn();
    bus.on('arbiter/lease-released', boom);
    bus.on('arbiter/lease-released', after);

    expect(() => bus.emit('arbiter/lease-released', { serviceId: 'svc' })).not.toThrow();

    expect(boom).toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith({ serviceId: 'svc' });
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('routes a thrown subscriber error to the injected logger with structured fields', () => {
    const error = vi.fn();
    const bus = new InMemoryEventBus({ error });

    const cause = new Error('handler exploded');
    bus.on('arbiter/lease-released', () => {
      throw cause;
    });

    bus.emit('arbiter/lease-released', { serviceId: 'svc' });

    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[event-bus] subscriber threw', {
      topic: 'arbiter/lease-released',
      error: cause,
    });
  });

  it('tolerates a handler that unsubscribes during dispatch', () => {
    const bus = new InMemoryEventBus();
    const second = vi.fn();
    const first = vi.fn(() => {
      bus.off('arbiter/lease-released', second);
    });
    bus.on('arbiter/lease-released', first);
    bus.on('arbiter/lease-released', second);

    // The dispatch snapshot means `second` still runs for the in-flight emit.
    expect(() => bus.emit('arbiter/lease-released', { serviceId: 'svc' })).not.toThrow();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    // ...but is gone for the next one.
    bus.emit('arbiter/lease-released', { serviceId: 'svc' });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
