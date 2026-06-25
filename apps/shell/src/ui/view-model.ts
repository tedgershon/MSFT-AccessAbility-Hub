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

/** Read a 0..1 number param, clamping out-of-range / non-numeric values to 0. */
function clamp01Param(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

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
 * - `caption` -> label taken from `params.text`.
 * - `sound-alert` -> label taken from `params.label` (non-speech sound cue).
 * - `flash-guard` -> full-window black dim whose alpha tracks `params.intensity`.
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
    case 'caption': {
      const text = typeof view.params?.text === 'string' ? view.params.text : '';
      return { kind: view.kind, label: text };
    }
    case 'sound-alert': {
      const sound = typeof view.params?.label === 'string' ? view.params.label : 'sound';
      return { kind: view.kind, label: `Sound: ${sound}` };
    }
    case 'flash-guard': {
      // The guard's protective dim: a full-window black layer whose opacity rises
      // with the detected flash intensity (0 = transparent, 1 = full blackout).
      const intensity = clamp01Param(view.params?.intensity);
      const fps =
        typeof view.params?.flashesPerSecond === 'number' ? view.params.flashesPerSecond : 0;
      const label =
        intensity > 0
          ? `Flash guard (dim ${Math.round(intensity * 100)}%${fps ? `, ${fps} flashes/s` : ''})`
          : 'Flash guard (monitoring)';
      return {
        kind: view.kind,
        label,
        style: { backgroundColor: `rgba(0, 0, 0, ${intensity.toFixed(3)})` },
      };
    }
    default:
      return { kind: view.kind, label: view.kind };
  }
}
