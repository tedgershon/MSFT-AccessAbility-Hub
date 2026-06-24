import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  unhealthy,
  type AccessibilityService,
  type HealthStatus,
  type ServiceContext,
} from '@aah/contracts';
import { CapturingBus, FakeService, newLifecycleLog } from '@aah/test-fixtures';
import { InMemoryConfigStore } from '../src/config-store.js';
import { LifecycleManager } from '../src/lifecycle.js';
import { ResourceArbiter } from '../src/resource-arbiter.js';
import { ServiceRegistry } from '../src/registry.js';
import { Supervisor, type SupervisorOptions } from '../src/supervisor.js';

function harness(opts: SupervisorOptions = {}) {
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
  const supervisor = new Supervisor(registry, lifecycle, bus, opts);
  return { bus, registry, arbiter, lifecycle, supervisor };
}

function healthPayloads(bus: CapturingBus, serviceId: string): HealthStatus[] {
  return bus.emitted
    .filter((e) => e.topic === 'service/health')
    .map((e) => e.payload as { serviceId: string; status: HealthStatus })
    .filter((p) => p.serviceId === serviceId)
    .map((p) => p.status);
}

describe('Supervisor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a healthy service running and emits its health', async () => {
    const log = newLifecycleLog();
    const { lifecycle, registry, supervisor, bus } = harness();
    const svc = new FakeService(log, { id: 'ok' });

    await lifecycle.load(svc);
    await lifecycle.enable('ok');

    await supervisor.tick();

    expect(registry.get('ok')?.phase).toBe('enabled');
    const statuses = healthPayloads(bus, 'ok');
    expect(statuses.at(-1)?.state).toBe('healthy');
    // No restart hooks fired for a healthy service.
    expect(log.calls).toEqual(['ok:onLoad', 'ok:onEnable']);
  });

  it('restarts an unhealthy service (disable + re-enable) with backoff', async () => {
    vi.useFakeTimers();
    const log = newLifecycleLog();
    const { lifecycle, registry, supervisor } = harness({ baseBackoffMs: 100 });
    const svc = new FakeService(log, { id: 'flaky', health: () => unhealthy('boom') });

    await lifecycle.load(svc);
    await lifecycle.enable('flaky');
    log.calls.length = 0; // snapshot after initial enable

    const pending = supervisor.tick();
    await vi.advanceTimersByTimeAsync(100); // let the backoff timer fire
    await pending;

    // Recovery is a disable followed by a re-enable.
    expect(log.calls).toEqual(['flaky:onDisable', 'flaky:onEnable']);
    expect(registry.get('flaky')?.phase).toBe('enabled');
  });

  it('trips the circuit breaker to "degraded" after N failed restarts', async () => {
    const log = newLifecycleLog();
    const { lifecycle, registry, supervisor, bus } = harness({ failureThreshold: 3 });
    // onDisable throwing keeps the recovery from completing, so each tick fails.
    const svc = new FakeService(log, {
      id: 'doomed',
      health: () => unhealthy('boom'),
      failOn: 'onDisable',
    });

    await lifecycle.load(svc);
    await lifecycle.enable('doomed');

    await supervisor.tick();
    expect(registry.get('doomed')?.phase).toBe('enabled'); // not tripped yet
    await supervisor.tick();
    expect(registry.get('doomed')?.phase).toBe('enabled');
    await supervisor.tick(); // 3rd failure trips the breaker

    expect(registry.get('doomed')?.phase).toBe('degraded');
    const phaseEvents = bus.emitted
      .filter((e) => e.topic === 'service/phase-changed')
      .map((e) => e.payload as { serviceId: string; phase: string });
    expect(phaseEvents).toContainEqual({ serviceId: 'doomed', phase: 'degraded' });

    // Once open, the breaker stops retrying (no further recovery churn).
    const before = log.calls.length;
    await supervisor.tick();
    expect(log.calls.length).toBe(before);
  });

  it('isolates an unhealthy service so peers keep running', async () => {
    const okLog = newLifecycleLog();
    const badLog = newLifecycleLog();
    const { lifecycle, registry, supervisor, bus } = harness({ failureThreshold: 1 });

    const ok = new FakeService(okLog, { id: 'ok' });
    const bad = new FakeService(badLog, {
      id: 'bad',
      health: () => unhealthy('boom'),
      failOn: 'onDisable',
    });

    await lifecycle.load(ok);
    await lifecycle.load(bad);
    await lifecycle.enable('ok');
    await lifecycle.enable('bad');

    await supervisor.tick(); // bad trips immediately (threshold 1)
    await supervisor.tick();

    expect(registry.get('bad')?.phase).toBe('degraded');
    // The healthy peer is untouched and still being polled.
    expect(registry.get('ok')?.phase).toBe('enabled');
    expect(healthPayloads(bus, 'ok').length).toBeGreaterThanOrEqual(2);
  });
});
