import { describe, expect, it } from 'vitest';
import {
  cap,
  type AccessibilityService,
  type ServiceContext,
} from '@aah/contracts';
import { CapturingBus, FakeService, newLifecycleLog } from '@aah/test-fixtures';
import { InMemoryConfigStore } from '../src/config-store.js';
import { LifecycleManager } from '../src/lifecycle.js';
import { ResourceArbiter } from '../src/resource-arbiter.js';
import { ServiceRegistry } from '../src/registry.js';

function harness() {
  const bus = new CapturingBus();
  const config = new InMemoryConfigStore();
  const registry = new ServiceRegistry();
  const arbiter = new ResourceArbiter(bus);
  const makeContext = (service: AccessibilityService): ServiceContext => ({
    bus,
    config,
    selfId: service.meta.id,
  });
  const lifecycle = new LifecycleManager(registry, arbiter, makeContext);
  return { bus, registry, arbiter, lifecycle };
}

describe('LifecycleManager', () => {
  it('drives onLoad -> onEnable -> onDisable -> onUnload in order', async () => {
    const log = newLifecycleLog();
    const { lifecycle } = harness();
    const svc = new FakeService(log, { id: 'svc' });

    await lifecycle.load(svc);
    await lifecycle.enable('svc');
    await lifecycle.disable('svc');
    await lifecycle.unload('svc');

    expect(log.calls).toEqual([
      'svc:onLoad',
      'svc:onEnable',
      'svc:onDisable',
      'svc:onUnload',
    ]);
  });

  it('records the phase in the registry across transitions', async () => {
    const log = newLifecycleLog();
    const { lifecycle, registry } = harness();
    const svc = new FakeService(log, { id: 'svc' });

    await lifecycle.load(svc);
    expect(registry.get('svc')?.phase).toBe('loaded');

    await lifecycle.enable('svc');
    expect(registry.get('svc')?.phase).toBe('enabled');

    await lifecycle.disable('svc');
    expect(registry.get('svc')?.phase).toBe('disabled');

    await lifecycle.unload('svc');
    // unload unregisters the service entirely.
    expect(registry.get('svc')).toBeUndefined();
  });

  it('blocks enable when the arbiter denies the lease', async () => {
    const log = newLifecycleLog();
    const { lifecycle, arbiter, registry } = harness();

    // A foreign holder occupies the camera exclusively.
    arbiter.request('other', [cap('camera', 'exclusive')]);

    const svc = new FakeService(log, { id: 'svc', requires: [cap('camera', 'exclusive')] });
    await lifecycle.load(svc);
    const result = await lifecycle.enable('svc');

    expect(result.enabled).toBe(false);
    expect(result.reason).toContain('camera');
    expect(result.reason).toContain('other');
    // onEnable must NOT have run and the phase must remain loaded.
    expect(log.calls).toEqual(['svc:onLoad']);
    expect(registry.get('svc')?.phase).toBe('loaded');
  });

  it('releases leases on disable (camera/mic rule)', async () => {
    const log = newLifecycleLog();
    const { lifecycle, arbiter, bus } = harness();
    const svc = new FakeService(log, { id: 'svc', requires: [cap('camera', 'exclusive')] });

    await lifecycle.load(svc);
    await lifecycle.enable('svc');
    expect(arbiter.holdersOf('camera')).toEqual(['svc']);

    await lifecycle.disable('svc');
    expect(arbiter.holdersOf('camera')).toEqual([]);
    expect(bus.topics()).toContain('arbiter/lease-released');
  });

  it('auto-disables before unloading an enabled service', async () => {
    const log = newLifecycleLog();
    const { lifecycle, arbiter } = harness();
    const svc = new FakeService(log, { id: 'svc', requires: [cap('camera', 'exclusive')] });

    await lifecycle.load(svc);
    await lifecycle.enable('svc');
    await lifecycle.unload('svc');

    expect(log.calls).toEqual([
      'svc:onLoad',
      'svc:onEnable',
      'svc:onDisable',
      'svc:onUnload',
    ]);
    // Auto-disable must also have released the lease.
    expect(arbiter.holdersOf('camera')).toEqual([]);
  });
});
