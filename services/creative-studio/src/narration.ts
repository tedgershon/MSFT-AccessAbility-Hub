/**
 * Narration core for Creative Studio — pure, no I/O.
 *
 * Turns *changes* in a creative app's state into short spoken utterances for a
 * blind / low-vision user. Diff-based on purpose: a screen reader that re-reads the
 * whole UI every tick is noise, so each describer announces only what changed since
 * the last snapshot (Strategy pattern, mirroring `colorblind-contrast/strategies`).
 *
 * Imports nothing outside the contracts types so it stays trivially unit-testable.
 */

/** A snapshot of the mediated creative app's salient state. */
export interface StudioState {
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

/** Speech urgency. `assertive` interrupts; `polite` waits its turn. */
export type Urgency = 'polite' | 'assertive';

/** One thing to say. */
export interface Utterance {
  /** Stable id of the describer that produced it (for ordering / tests). */
  source: string;
  text: string;
  urgency: Urgency;
}

/** A neutral starting state, so the first narration describes everything new. */
export function emptyState(app = 'unknown'): StudioState {
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

/** Describes one facet of a state transition. Returns an utterance or `null`. */
export interface Describer {
  readonly source: string;
  describe(prev: StudioState, next: StudioState): Utterance | null;
}

function pct(zoom: number): string {
  return `${Math.round(zoom * 100)} percent`;
}

/** A dialog opening is assertive — it changes what the user can do right now. */
const dialogDescriber: Describer = {
  source: 'dialog',
  describe(prev, next) {
    if (prev.dialog === next.dialog) return null;
    if (next.dialog) return { source: 'dialog', text: `${next.dialog} dialog opened`, urgency: 'assertive' };
    return { source: 'dialog', text: 'Dialog closed', urgency: 'polite' };
  },
};

const toolDescriber: Describer = {
  source: 'tool',
  describe(prev, next) {
    if (prev.tool === next.tool || !next.tool) return null;
    return { source: 'tool', text: `${next.tool} tool selected`, urgency: 'polite' };
  },
};

const selectionDescriber: Describer = {
  source: 'selection',
  describe(prev, next) {
    if (prev.selection === next.selection) return null;
    if (next.selection) return { source: 'selection', text: `Selected ${next.selection}`, urgency: 'polite' };
    return { source: 'selection', text: 'Selection cleared', urgency: 'polite' };
  },
};

const layerDescriber: Describer = {
  source: 'layer',
  describe(prev, next) {
    if (prev.activeLayer === next.activeLayer || !next.activeLayer) return null;
    return { source: 'layer', text: `Active layer ${next.activeLayer}`, urgency: 'polite' };
  },
};

const zoomDescriber: Describer = {
  source: 'zoom',
  describe(prev, next) {
    if (prev.zoom === next.zoom) return null;
    return { source: 'zoom', text: `Zoom ${pct(next.zoom)}`, urgency: 'polite' };
  },
};

/** Status messages are assertive so completions/errors aren't missed. */
const statusDescriber: Describer = {
  source: 'status',
  describe(prev, next) {
    if (!next.status || prev.status === next.status) return null;
    return { source: 'status', text: next.status, urgency: 'assertive' };
  },
};

/** The standard describer set. */
export function defaultDescribers(): Describer[] {
  return [
    dialogDescriber,
    statusDescriber,
    toolDescriber,
    selectionDescriber,
    layerDescriber,
    zoomDescriber,
  ];
}

/**
 * Narrates state transitions. Stateless except for the configured describers;
 * callers own the "previous state" so the narrator is reusable and pure-ish.
 */
export class Narrator {
  readonly #describers: Describer[];

  constructor(describers: Describer[] = defaultDescribers()) {
    this.#describers = describers;
  }

  /** Utterances for `prev -> next`, assertive ones first, in describer order. */
  narrate(prev: StudioState, next: StudioState): Utterance[] {
    const out: Utterance[] = [];
    for (const d of this.#describers) {
      const u = d.describe(prev, next);
      if (u) out.push(u);
    }
    // Stable sort: assertive utterances lead so the speech sink can flush/interrupt.
    return out.sort((a, b) => Number(b.urgency === 'assertive') - Number(a.urgency === 'assertive'));
  }
}
