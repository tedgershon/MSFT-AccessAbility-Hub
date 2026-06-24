/**
 * Tests for the hub bootstrap wiring — specifically the arbiter-denial escalation
 * policy: only a contested *control* channel should be escalated to the coordinator
 * for a mode-switch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHub, type Hub } from './bootstrap.js';

describe('createHub — arbiter-denial escalation', () => {
  let hub: Hub | undefined;

  afterEach(async () => {
    await hub?.kernel.shutdown();
    hub = undefined;
    vi.restoreAllMocks();
  });

  it('escalates a denied control channel to the coordinator', async () => {
    hub = await createHub();
    const arbitrate = vi.spyOn(hub.coordinator, 'arbitrate');

    hub.kernel.bus.emit('arbiter/lease-denied', {
      serviceId: 'a',
      conflictsWith: ['b'],
      resources: ['keyboard'],
    });

    expect(arbitrate).toHaveBeenCalledWith('input', ['a', 'b']);
  });

  it('ignores a denied non-control resource', async () => {
    hub = await createHub();
    const arbitrate = vi.spyOn(hub.coordinator, 'arbitrate');

    hub.kernel.bus.emit('arbiter/lease-denied', {
      serviceId: 'a',
      conflictsWith: ['b'],
      resources: ['displayOverlay'],
    });

    expect(arbitrate).not.toHaveBeenCalled();
  });

  it('escalates when any denied resource is a control channel', async () => {
    hub = await createHub();
    const arbitrate = vi.spyOn(hub.coordinator, 'arbitrate');

    hub.kernel.bus.emit('arbiter/lease-denied', {
      serviceId: 'a',
      conflictsWith: ['b'],
      resources: ['displayOverlay', 'cursor'],
    });

    expect(arbitrate).toHaveBeenCalledWith('input', ['a', 'b']);
  });
});
