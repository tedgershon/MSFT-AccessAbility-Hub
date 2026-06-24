import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '@aah/kernel';
import type { OverlayLayer } from '@aah/contracts';
import { OverlaySurface } from './overlay-surface.js';

function layer(over: Partial<OverlayLayer> = {}): OverlayLayer {
  return { id: 'l1', ownerId: 'svc-a', kind: 'color-correction', ...over };
}

describe('OverlaySurface', () => {
  it('attaching adds a layer to the registry', () => {
    const bus = new InMemoryEventBus();
    const surface = new OverlaySurface();
    surface.mount(bus);

    bus.emit('overlay/attach', layer());

    expect(surface.layers()).toHaveLength(1);
    expect(surface.get('l1')).toEqual(layer());
  });

  it('detaching removes the layer by id', () => {
    const bus = new InMemoryEventBus();
    const surface = new OverlaySurface();
    surface.mount(bus);

    bus.emit('overlay/attach', layer());
    bus.emit('overlay/detach', { id: 'l1', ownerId: 'svc-a' });

    expect(surface.get('l1')).toBeUndefined();
    expect(surface.layers()).toHaveLength(0);
  });

  it('updating mutates an attached layer in place', () => {
    const bus = new InMemoryEventBus();
    const surface = new OverlaySurface();
    surface.mount(bus);

    bus.emit('overlay/attach', layer({ kind: 'caption', params: { text: 'hello' } }));
    bus.emit('overlay/update', layer({ kind: 'caption', params: { text: 'world' } }));

    expect(surface.layers()).toHaveLength(1);
    expect(surface.get('l1')?.params).toEqual({ text: 'world' });
  });

  it('updating an unknown layer is a no-op (no upsert)', () => {
    const bus = new InMemoryEventBus();
    const surface = new OverlaySurface();
    surface.mount(bus);

    bus.emit('overlay/update', layer({ id: 'ghost' }));

    expect(surface.get('ghost')).toBeUndefined();
    expect(surface.layers()).toHaveLength(0);
  });

  it('keeps layers from different owners isolated', () => {
    const bus = new InMemoryEventBus();
    const surface = new OverlaySurface();
    surface.mount(bus);

    bus.emit('overlay/attach', layer({ id: 'a', ownerId: 'svc-a' }));
    bus.emit('overlay/attach', layer({ id: 'b', ownerId: 'svc-b', kind: 'caption' }));
    bus.emit('overlay/detach', { id: 'a', ownerId: 'svc-a' });

    expect(surface.get('a')).toBeUndefined();
    expect(surface.get('b')?.ownerId).toBe('svc-b');
    expect(surface.layers()).toHaveLength(1);
  });

  it('unmount drops layers and stops consuming events', () => {
    const bus = new InMemoryEventBus();
    const surface = new OverlaySurface();
    surface.mount(bus);

    bus.emit('overlay/attach', layer());
    surface.unmount();

    expect(surface.layers()).toHaveLength(0);
    bus.emit('overlay/attach', layer({ id: 'after' }));
    expect(surface.get('after')).toBeUndefined();
  });
});
