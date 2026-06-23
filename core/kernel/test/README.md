# Kernel test plan

> No tests are implemented in this scaffold. This file pins the suites the kernel
> needs and the fixtures available to write them. Use `@aah/test-fixtures` for the
> `FakeService`, `CapturingBus`, and `LifecycleLog` helpers.

Place specs here as `*.test.ts` (picked up by the root `vitest.config.ts`).

## Resource Arbiter (`resource-arbiter.test.ts`)
- two `shared` requests on the same resource → both granted.
- `exclusive` vs `exclusive` on the same resource → second denied, emits
  `arbiter/lease-denied` with the holder in `conflictsWith`.
- `exclusive` vs `shared` collision → denied.
- disjoint resources → granted.
- `release()` frees leases and emits `arbiter/lease-released`.
- all-or-nothing: a multi-capability request with one collision grants nothing.

## Lifecycle Manager (`lifecycle.test.ts`)
- `load → enable → disable → unload` records hooks in order (assert via `LifecycleLog`).
- `enable` is blocked when the arbiter denies the lease.
- `disable` releases leases (camera/mic rule).
- `unload` from `enabled` auto-disables first.

## Supervisor (`supervisor.test.ts`)
- `unhealthy` service is disabled + re-enabled (drive `tick()` manually).
- restart backoff grows; repeated failure trips the breaker → phase `degraded`.
- a degraded service does NOT take down healthy peers (crash isolation).

## Event Bus (`event-bus.test.ts`)
- `emit`/`on`/`off` delivery; unsubscribe via returned disposer.
- a throwing subscriber does not break delivery to others.
