/**
 * @aah/test-fixtures — shared fixtures and fakes.
 *
 * This package exists to make the suites in each package easy to write. It provides
 * a configurable fake service, a record of lifecycle calls, and a capturing bus
 * spy. It deliberately contains NO tests itself.
 */

import {
  type AccessibilityService,
  type Capability,
  type EventBus,
  type EventHandler,
  type EventPayload,
  type EventTopic,
  type HealthStatus,
  healthy,
  type ServiceContext,
  type ServiceMeta,
} from '@aah/contracts';

/** Records lifecycle transitions so a test can assert order/side effects. */
export interface LifecycleLog {
  calls: string[];
}

export interface FakeServiceOptions {
  id?: string;
  requires?: Capability[];
  /** Override what `healthCheck()` returns (e.g. to drive the supervisor). */
  health?: () => HealthStatus;
  /** Force a phase hook to throw, to exercise crash isolation / recovery. */
  failOn?: 'onEnable' | 'onDisable' | 'onLoad' | 'onUnload';
}

/**
 * A minimal, instrumented service for tests. Pair with {@link LifecycleLog} to
 * assert that the kernel drove the lifecycle correctly.
 */
export class FakeService implements AccessibilityService {
  readonly meta: ServiceMeta;
  readonly requires: Capability[];

  constructor(
    private readonly log: LifecycleLog,
    private readonly opts: FakeServiceOptions = {},
  ) {
    this.meta = {
      id: opts.id ?? 'fake',
      name: 'Fake Service',
      version: '0.0.0',
    };
    this.requires = opts.requires ?? [];
  }

  async onLoad(_ctx: ServiceContext): Promise<void> {
    this.record('onLoad');
  }
  async onEnable(): Promise<void> {
    this.record('onEnable');
  }
  async onDisable(): Promise<void> {
    this.record('onDisable');
  }
  async onUnload(): Promise<void> {
    this.record('onUnload');
  }

  healthCheck(): HealthStatus {
    return this.opts.health?.() ?? healthy();
  }

  private record(call: FakeServiceOptions['failOn'] & string): void {
    this.log.calls.push(`${this.meta.id}:${call}`);
    if (this.opts.failOn === call) throw new Error(`forced failure in ${call}`);
  }
}

/** Captures every emitted event so a test can assert what the kernel published. */
export class CapturingBus implements EventBus {
  readonly emitted: Array<{ topic: EventTopic; payload: unknown }> = [];
  readonly #handlers = new Map<EventTopic, Set<EventHandler<EventTopic>>>();

  emit<T extends EventTopic>(topic: T, payload: EventPayload<T>): void {
    this.emitted.push({ topic, payload });
    for (const h of this.#handlers.get(topic) ?? []) (h as EventHandler<T>)(payload);
  }

  on<T extends EventTopic>(topic: T, handler: EventHandler<T>): () => void {
    const set = this.#handlers.get(topic) ?? new Set();
    set.add(handler as EventHandler<EventTopic>);
    this.#handlers.set(topic, set);
    return () => this.off(topic, handler);
  }

  off<T extends EventTopic>(topic: T, handler: EventHandler<T>): void {
    this.#handlers.get(topic)?.delete(handler as EventHandler<EventTopic>);
  }

  topics(): EventTopic[] {
    return this.emitted.map((e) => e.topic);
  }
}

export function newLifecycleLog(): LifecycleLog {
  return { calls: [] };
}
