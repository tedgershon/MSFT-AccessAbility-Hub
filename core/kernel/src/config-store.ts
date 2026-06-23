/**
 * Config / State Store.
 *
 * A trivial in-memory key/value store injected into every service via DI. Swap for
 * a persisted backend (e.g. file / SQLite) without touching service code.
 */

import type { ConfigStore } from '@aah/contracts';

export class InMemoryConfigStore implements ConfigStore {
  readonly #data = new Map<string, unknown>();

  get<T = unknown>(key: string): T | undefined {
    return this.#data.get(key) as T | undefined;
  }

  set<T = unknown>(key: string, value: T): void {
    this.#data.set(key, value);
  }
}
