import { describe, expect, it } from 'vitest';
import { cap, type Capability } from '@aah/contracts';
import { CapturingBus } from '@aah/test-fixtures';
import { ResourceArbiter } from '../src/resource-arbiter.js';

function payloadsOf(bus: CapturingBus, topic: string): unknown[] {
  return bus.emitted.filter((e) => e.topic === topic).map((e) => e.payload);
}

describe('ResourceArbiter', () => {
  it('grants two shared requests on the same resource', () => {
    const bus = new CapturingBus();
    const arbiter = new ResourceArbiter(bus);

    expect(arbiter.request('a', [cap('camera', 'shared')]).ok).toBe(true);
    expect(arbiter.request('b', [cap('camera', 'shared')]).ok).toBe(true);

    expect(arbiter.holdersOf('camera').sort()).toEqual(['a', 'b']);
  });

  it('denies exclusive vs exclusive on the same resource and names the holder', () => {
    const bus = new CapturingBus();
    const arbiter = new ResourceArbiter(bus);

    expect(arbiter.request('a', [cap('camera', 'exclusive')]).ok).toBe(true);
    const result = arbiter.request('b', [cap('camera', 'exclusive')]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected denial');
    expect(result.conflictsWith).toContain('a');
    expect(result.resources).toContain('camera');

    // Only the first holder is registered; the denied request grants nothing.
    expect(arbiter.holdersOf('camera')).toEqual(['a']);
  });

  it('denies an exclusive vs shared collision', () => {
    const bus = new CapturingBus();
    const arbiter = new ResourceArbiter(bus);

    expect(arbiter.request('a', [cap('audioIn', 'shared')]).ok).toBe(true);
    const result = arbiter.request('b', [cap('audioIn', 'exclusive')]);

    expect(result.ok).toBe(false);
    expect(arbiter.holdersOf('audioIn')).toEqual(['a']);
  });

  it('grants disjoint resources', () => {
    const bus = new CapturingBus();
    const arbiter = new ResourceArbiter(bus);

    expect(arbiter.request('a', [cap('camera', 'exclusive')]).ok).toBe(true);
    expect(arbiter.request('b', [cap('cursor', 'exclusive')]).ok).toBe(true);

    expect(arbiter.holdersOf('camera')).toEqual(['a']);
    expect(arbiter.holdersOf('cursor')).toEqual(['b']);
  });

  it('is all-or-nothing: a multi-capability request with one collision grants nothing', () => {
    const bus = new CapturingBus();
    const arbiter = new ResourceArbiter(bus);

    // Pre-occupy the cursor exclusively.
    expect(arbiter.request('holder', [cap('cursor', 'exclusive')]).ok).toBe(true);

    const wants: Capability[] = [cap('keyboard', 'exclusive'), cap('cursor', 'exclusive')];
    const result = arbiter.request('b', wants);

    expect(result.ok).toBe(false);
    // The non-conflicting capability must NOT have leaked a lease.
    expect(arbiter.holdersOf('keyboard')).toEqual([]);
    expect(arbiter.holdersOf('cursor')).toEqual(['holder']);
  });

  it('release() frees every lease held by a service and reflects in holdersOf()', () => {
    const bus = new CapturingBus();
    const arbiter = new ResourceArbiter(bus);

    arbiter.request('a', [cap('camera', 'exclusive'), cap('keyboard', 'exclusive')]);
    expect(arbiter.holdersOf('camera')).toEqual(['a']);
    expect(arbiter.holdersOf('keyboard')).toEqual(['a']);

    arbiter.release('a');

    expect(arbiter.holdersOf('camera')).toEqual([]);
    expect(arbiter.holdersOf('keyboard')).toEqual([]);
    // The resource is now free for another exclusive holder.
    expect(arbiter.request('b', [cap('camera', 'exclusive')]).ok).toBe(true);
  });

  it('emits arbiter/lease-granted on grant', () => {
    const bus = new CapturingBus();
    const arbiter = new ResourceArbiter(bus);

    arbiter.request('a', [cap('camera', 'shared')]);

    const granted = payloadsOf(bus, 'arbiter/lease-granted');
    expect(granted).toHaveLength(1);
    expect(granted[0]).toMatchObject({ serviceId: 'a' });
  });

  it('emits arbiter/lease-denied on a conflict', () => {
    const bus = new CapturingBus();
    const arbiter = new ResourceArbiter(bus);

    arbiter.request('a', [cap('camera', 'exclusive')]);
    arbiter.request('b', [cap('camera', 'exclusive')]);

    const denied = payloadsOf(bus, 'arbiter/lease-denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ serviceId: 'b', conflictsWith: ['a'] });
  });

  it('emits arbiter/lease-released on release', () => {
    const bus = new CapturingBus();
    const arbiter = new ResourceArbiter(bus);

    arbiter.request('a', [cap('camera', 'shared')]);
    arbiter.release('a');

    const released = payloadsOf(bus, 'arbiter/lease-released');
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ serviceId: 'a' });
  });
});
