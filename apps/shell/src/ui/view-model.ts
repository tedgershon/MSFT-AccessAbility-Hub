/**
 * View-model — PURE presentation logic for the shell UI.
 *
 * Maps kernel/overlay domain objects into the serialisable view types the renderer
 * paints. Imports nothing from `electron`, `node`, or the DOM (only erased,
 * type-only imports from the kernel + contracts), so it is fully unit-testable under
 * plain Node/vitest and reusable by both the main process and any future renderer.
 */

import type { OverlayLayer } from '@aah/contracts';
import type { ServiceRecord } from '@aah/kernel';
import type { HealthView, OverlayLayerView, ServiceView } from './ipc-contract.js';

/** Map a kernel registry record to a renderer-facing {@link ServiceView}. */
function recordToServiceView(record: ServiceRecord): ServiceView {
  const health = record.service.healthCheck();
  const view: HealthView = { state: health.state };
  if (health.detail !== undefined) view.detail = health.detail;
  return {
    id: record.service.meta.id,
    name: record.service.meta.name,
    phase: record.phase,
    health: view,
  };
}

/** Map the kernel registry's records to the service rows the renderer paints. */
export function toServiceViews(records: readonly ServiceRecord[]): ServiceView[] {
  return records.map(recordToServiceView);
}

/** Map a domain {@link OverlayLayer} to a serialisable {@link OverlayLayerView}. */
export function overlayLayerToView(layer: OverlayLayer): OverlayLayerView {
  const view: OverlayLayerView = {
    id: layer.id,
    ownerId: layer.ownerId,
    kind: layer.kind,
  };
  if (layer.params !== undefined) view.params = { ...layer.params };
  return view;
}

/**
 * CSS `filter` presets per colour-correction strategy.
 *
 * NOTE: these are DOCUMENTED PLACEHOLDERS — plausible hue/contrast nudges so the
 * overlay visibly changes per strategy, not clinically accurate daltonisation. A
 * real implementation would swap these for calibrated SVG colour-matrix filters.
 */
const COLOR_CORRECTION_FILTERS: Record<string, string> = {
  deuteranopia: 'contrast(1.1) hue-rotate(20deg) saturate(1.15)',
  protanopia: 'contrast(1.1) hue-rotate(-20deg) saturate(1.15)',
  tritanopia: 'contrast(1.1) hue-rotate(180deg) saturate(1.1)',
};

/** Fallback filter when the strategy is missing or unrecognised. */
const DEFAULT_COLOR_CORRECTION_FILTER = 'contrast(1.05)';

/**
 * Per-cognitive-style typography presets for the adaptive-text overlay.
 *
 * Like {@link COLOR_CORRECTION_FILTERS} these are DOCUMENTED PLACEHOLDERS — coarse
 * spacing/weight nudges so the restructured text reads differently per style, not a
 * tuned reading-science profile. The `adaptive-learning` service restructures the
 * text itself (chunked bullets / spaced lines / numbered steps); these hints just
 * tell the renderer how to *present* that re-injected text.
 */
const ADAPTIVE_TEXT_STYLES: Record<string, Record<string, string>> = {
  adhd: { lineHeight: '1.6', letterSpacing: '0.02em', fontWeight: '600' },
  dyslexia: { lineHeight: '2', letterSpacing: '0.08em', wordSpacing: '0.16em' },
  autism: { lineHeight: '1.8', letterSpacing: '0.03em' },
};

/** Fallback typography when the cognitive style is missing or unrecognised. */
const DEFAULT_ADAPTIVE_TEXT_STYLE: Record<string, string> = { lineHeight: '1.6' };

/** A presentation hint the renderer uses to paint a layer. */
export interface OverlayDescriptor {
  kind: string;
  /** Human-readable label for the layer (caption text, strategy name, ...). */
  label: string;
  /** Optional inline CSS (camelCase keys -> values) the renderer applies. */
  style?: Record<string, string>;
}

/**
 * Derive a render hint for an overlay layer. Generic + default-safe: unknown kinds
 * fall back to a labelled chip with no special styling.
 *
 * Known kinds:
 * - `color-correction` -> full-window CSS `filter` derived from `params.strategy`.
 * - `adaptive-text` -> typography preset derived from `params.style` (cognitive style).
 * - `caption` -> label taken from `params.text`.
 */
export function describeOverlayLayer(view: OverlayLayerView): OverlayDescriptor {
  switch (view.kind) {
    case 'color-correction': {
      const strategy =
        typeof view.params?.strategy === 'string' ? view.params.strategy : undefined;
      const filter =
        (strategy && COLOR_CORRECTION_FILTERS[strategy]) ?? DEFAULT_COLOR_CORRECTION_FILTER;
      return {
        kind: view.kind,
        label: `Colour correction${strategy ? ` (${strategy})` : ''}`,
        style: { filter },
      };
    }
    case 'adaptive-text': {
      const style =
        typeof view.params?.style === 'string' ? view.params.style : undefined;
      const typography =
        (style && ADAPTIVE_TEXT_STYLES[style]) ?? DEFAULT_ADAPTIVE_TEXT_STYLE;
      return {
        kind: view.kind,
        label: `Adaptive text${style ? ` (${style})` : ''}`,
        style: { ...typography },
      };
    }
    case 'caption': {
      const text = typeof view.params?.text === 'string' ? view.params.text : '';
      return { kind: view.kind, label: text };
    }
    default:
      return { kind: view.kind, label: view.kind };
  }
}
