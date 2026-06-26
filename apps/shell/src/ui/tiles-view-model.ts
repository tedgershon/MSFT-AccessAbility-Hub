/**
 * Tiles view-model — PURE presentation logic for the home grid.
 *
 * Merges the static {@link TILE_CATALOG} with the live {@link ServiceView} snapshot
 * pushed over `window.hub`, applies the user's search / tag-filter / pin choices, and
 * returns a grouped, ready-to-paint view. Imports nothing from `electron`, `node`, or
 * the DOM, so it is fully unit-testable under plain Node/vitest and keeps the renderer
 * a thin DOM-painter.
 */

import type { ServiceView } from './ipc-contract.js';
import type { HealthView } from './ipc-contract.js';
import { GROUP_ORDER, type TileDef, type TileIcon, type TilePhase } from './tiles.js';

/** Resolved availability/lifecycle status of a tile, never colour-only at render. */
export type TileStatus = 'available' | 'setup-needed' | 'coming-soon';

/** A single tile, ready for the renderer to paint (anatomy §5). */
export interface TileView {
  id: string;
  title: string;
  description: string;
  group: string;
  tag: string;
  input: string;
  icon: TileIcon;
  phase: TilePhase;
  status: TileStatus;
  /** Status text shown beside the dot. Health state when available, else a phrase. */
  statusLabel: string;
  /** True only for `built` tiles whose backing service is in the live snapshot. */
  available: boolean;
  /** Whether the backing service is currently enabled (meaningful when available). */
  enabled: boolean;
  /** Live health of the backing service; null unless available. */
  health: HealthView | null;
  /** Short reason shown for a `setup-needed` tile. */
  reason: string | null;
  /** Whether the user has pinned this tile. */
  pinned: boolean;
}

/** A rendered section: a group header plus its tiles. */
export interface TileGroupView {
  title: string;
  tiles: TileView[];
}

/** The full home view: ordered groups plus filter metadata. */
export interface TilesView {
  groups: TileGroupView[];
  /** Number of tiles after filtering (across all groups). */
  total: number;
  /** All impairment tags in the catalog (for the filter control), sorted. */
  tags: string[];
}

/** Inputs to {@link tilesViewModel}. */
export interface TilesViewModelInput {
  catalog: readonly TileDef[];
  /** Live service rows pushed over the bridge, keyed downstream by id. */
  services: readonly ServiceView[];
  /** Free-text query matched against title, description, and tag. */
  search?: string;
  /** Tag to filter by; `null`/`undefined` means "all". */
  tagFilter?: string | null;
  /** Ids the user has pinned (floated to a "Pinned" section). */
  pinned?: readonly string[];
}

/** Title of the synthetic section pinned tiles float into. */
export const PINNED_GROUP_TITLE = 'Pinned';

function matchesSearch(def: TileDef, needle: string): boolean {
  const haystack = `${def.title} ${def.description} ${def.tag}`.toLowerCase();
  return haystack.includes(needle);
}

function toTileView(
  def: TileDef,
  service: ServiceView | undefined,
  pinned: boolean,
): TileView {
  const base = {
    id: def.id,
    title: def.title,
    description: def.description,
    group: def.group,
    tag: def.tag,
    input: def.input,
    icon: def.icon,
    phase: def.phase,
    pinned,
  };

  if (def.phase === 'planned') {
    return {
      ...base,
      status: 'coming-soon',
      statusLabel: 'Coming soon',
      available: false,
      enabled: false,
      health: null,
      reason: 'Not built yet',
    };
  }

  // `built` (or `partial`) tiles need their backing service in the live snapshot to
  // toggle. A missing service degrades gracefully to a "Setup needed" state (§9).
  if (def.phase === 'partial' || service === undefined) {
    return {
      ...base,
      status: 'setup-needed',
      statusLabel: 'Setup needed',
      available: false,
      enabled: false,
      health: null,
      reason: def.phase === 'partial' ? 'In progress' : 'Service not running',
    };
  }

  const enabled = service.phase === 'enabled';
  return {
    ...base,
    status: 'available',
    statusLabel: service.health.state,
    available: true,
    enabled,
    health: service.health,
    reason: null,
  };
}

/**
 * Build the grouped, filtered home view from the catalog + live snapshot + the user's
 * search / tag / pin choices.
 *
 * Ordering: a synthetic "Pinned" section first (pinned tiles are shown there only,
 * not duplicated in their category), then category groups in {@link GROUP_ORDER}.
 * Empty groups are omitted.
 */
export function tilesViewModel(input: TilesViewModelInput): TilesView {
  const services = new Map(input.services.map((s) => [s.id, s]));
  const pinnedSet = new Set(input.pinned ?? []);
  const needle = (input.search ?? '').trim().toLowerCase();
  const tagFilter = input.tagFilter ?? null;

  const tags = [...new Set(input.catalog.map((d) => d.tag))].sort((a, b) =>
    a.localeCompare(b),
  );

  const pinnedTiles: TileView[] = [];
  const byGroup = new Map<string, TileView[]>();

  for (const def of input.catalog) {
    if (tagFilter && def.tag !== tagFilter) continue;
    if (needle && !matchesSearch(def, needle)) continue;

    const isPinned = pinnedSet.has(def.id);
    const view = toTileView(def, services.get(def.id), isPinned);

    if (isPinned) {
      pinnedTiles.push(view);
    } else {
      const bucket = byGroup.get(def.group);
      if (bucket) bucket.push(view);
      else byGroup.set(def.group, [view]);
    }
  }

  const groups: TileGroupView[] = [];
  if (pinnedTiles.length > 0) {
    groups.push({ title: PINNED_GROUP_TITLE, tiles: pinnedTiles });
  }
  for (const title of GROUP_ORDER) {
    const tiles = byGroup.get(title);
    if (tiles && tiles.length > 0) groups.push({ title, tiles });
  }
  // Surface any tiles whose group isn't in GROUP_ORDER (defensive: keeps new
  // categories visible instead of silently dropping them).
  for (const [title, tiles] of byGroup) {
    if (!GROUP_ORDER.includes(title)) groups.push({ title, tiles });
  }

  const total = pinnedTiles.length + [...byGroup.values()].reduce((n, t) => n + t.length, 0);
  return { groups, total, tags };
}
