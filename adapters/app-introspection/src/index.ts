/**
 * App Introspection adapter.
 *
 * Wraps "read the creative app's salient state" (accessibility tree / app
 * introspection) behind a narrow, leasable channel so services never touch the OS
 * accessibility APIs directly (Adapter pattern). Holding the channel open
 * corresponds to a `commandChannel` lease the owning service holds; the service
 * MUST `close()` it on disable.
 *
 * The real data source is abstracted behind an {@link AppStateReader}, so the
 * adapter runs hardware-free in tests via {@link ScriptedAppStateChannel}. Business
 * logic (what to narrate, how to diff) belongs in the consuming service, not here —
 * this adapter only surfaces capability (Interface Segregation).
 */

/** A snapshot of a mediated creative app's salient state. */
export interface AppStateSnapshot {
  /** App identity, e.g. `'image-editor'`. */
  app: string;
  /** Currently selected tool, e.g. `'brush'`. */
  tool: string;
  /** Human description of the current selection, or `null` if nothing is selected. */
  selection: string | null;
  /** Active layer / track name, or `null`. */
  activeLayer: string | null;
  /** Canvas zoom as a ratio (1 = 100%). */
  zoom: number;
  /** Open modal / dialog title, or `null` when none is open. */
  dialog: string | null;
  /** Transient status line (e.g. `'Exported export.png'`), or `null`. */
  status: string | null;
}

/** A neutral starting state, so the first read describes everything as new. */
export function emptyAppState(app = 'unknown'): AppStateSnapshot {
  return {
    app,
    tool: '',
    selection: null,
    activeLayer: null,
    zoom: 1,
    dialog: null,
    status: null,
  };
}

/**
 * Leased read channel to the mediated creative app. Opened/closed in step with the
 * owning service's `commandChannel` lease.
 */
export interface AppStateChannel {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  /** Latest state snapshot, or `null` when nothing new is available. */
  poll(): AppStateSnapshot | null;
}

/**
 * The narrow data source the adapter drives. Real wiring (OS accessibility tree,
 * app plugin, screen scrape) is injected as a function so this module imports
 * cleanly with no platform dependency.
 */
export type AppStateReader = () => AppStateSnapshot | null;

/**
 * Real channel: surfaces snapshots from an injected {@link AppStateReader}. Keeps no
 * platform handles of its own beyond the open/closed lease flag; reading only
 * happens between `open()` and `close()`.
 */
export class AppIntrospectionAdapter implements AppStateChannel {
  #open = false;
  readonly #read: AppStateReader;

  constructor(read: AppStateReader) {
    this.#read = read;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  poll(): AppStateSnapshot | null {
    if (!this.#open) throw new Error('poll() before open()');
    return this.#read();
  }
}

/** Hardware-free channel that replays a fixed list of state snapshots (for tests). */
export class ScriptedAppStateChannel implements AppStateChannel {
  #open = false;
  openCount = 0;
  closeCount = 0;
  readonly #queue: AppStateSnapshot[];

  constructor(states: AppStateSnapshot[] = []) {
    this.#queue = [...states];
  }

  get isOpen(): boolean {
    return this.#open;
  }

  open(): void {
    if (!this.#open) {
      this.#open = true;
      this.openCount += 1;
    }
  }

  close(): void {
    if (this.#open) {
      this.#open = false;
      this.closeCount += 1;
    }
  }

  poll(): AppStateSnapshot | null {
    if (!this.#open) throw new Error('poll() before open()');
    return this.#queue.shift() ?? null;
  }
}
