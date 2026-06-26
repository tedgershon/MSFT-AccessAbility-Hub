/**
 * Tile catalog — the typed data the home grid renders.
 *
 * PURE data + types: imports nothing from `electron`, `node`, or the DOM. One tile =
 * one user-facing accessibility aid. `id` is the backing service id used with
 * `window.hub`. This is the single source of truth for the tiles the shell paints;
 * the view-model ({@link ./tiles-view-model}) merges these rows with the live service
 * snapshot pushed over the bridge. Keep it in sync with issue #1's pinned catalog and
 * the `services/` tree as tiles land.
 */

/**
 * Build status of a tile's backing aid:
 * - `built`    — the service exists and toggles live via `window.hub`.
 * - `partial`  — provisional / in progress; rendered in a "Setup needed" state.
 * - `planned`  — not built yet; rendered in a "Coming soon" state.
 */
export type TilePhase = 'built' | 'partial' | 'planned';

/**
 * An icon key. Drives the tinted icon tile (colour + glyph) so users locate aids by
 * shape + colour, not by reading alone (recognition over recall). Most aids use their
 * impairment-category glyph; a few use a more descriptive, aid-specific glyph.
 */
export type TileIcon =
  | 'vision'
  | 'colour'
  | 'hearing'
  | 'cognitive'
  | 'motor'
  | 'social'
  | 'photo'
  | 'describe'
  | 'privacy'
  | 'creative'
  | 'simplify';

/**
 * A hardware / OS capability an aid depends on. Surfaced as a small emoji tag under
 * each tile so users can see at a glance what an aid will use (camera, mic, screen, …).
 */
export type InputSource =
  | 'camera'
  | 'microphone'
  | 'screen'
  | 'os-input'
  | 'files'
  | 'audio-out';

/** One aid in the catalog. */
export interface TileDef {
  /** Backing service id used with `window.hub.enable/disable`. */
  id: string;
  /** Short, human-facing name. */
  title: string;
  /** One scannable sentence describing what the aid does. */
  description: string;
  /** Impairment-category group header the tile sits under (drives §4 sections). */
  group: string;
  /** Impairment tag — also a search key (e.g. `low vision`, `dyslexia`). */
  tag: string;
  /** Primary input the aid needs (screen, microphone, camera, …). */
  input: string;
  /** Input sources the aid relies on; rendered as emoji tags under the tile. */
  inputs: InputSource[];
  /** Build status — gates whether the tile toggles live. */
  phase: TilePhase;
  /** Category icon key for the tinted icon tile. */
  icon: TileIcon;
}

/**
 * Default group order for the home sections, mirroring the catalog's impairment-tag
 * grouping. Groups with no (filtered) tiles are omitted at render time.
 */
export const GROUP_ORDER: readonly string[] = [
  'Vision',
  'Color Vision',
  'Hearing',
  'Dyslexia, ADHD & Cognitive',
  'Dexterity',
  'Autism',
  'Epilepsy',
];

/**
 * The aids to surface. Source of truth: issue #1's pinned catalog + the `services/`
 * tree. Render every tile — including `partial` / `planned` ones — never hide them.
 */
export const TILE_CATALOG: readonly TileDef[] = [
  {
    id: 'scene-describer',
    title: 'Scene Describer',
    description: 'Tells you what your camera sees.',
    group: 'Vision',
    tag: 'blind & low vision',
    input: 'camera',
    inputs: ['camera'],
    phase: 'partial',
    icon: 'describe',
  },
  {
    id: 'privacy-guard',
    title: 'Privacy Guard',
    description: 'Warns you before you share private things.',
    group: 'Vision',
    tag: 'blind & low vision',
    input: 'camera / files',
    inputs: ['screen', 'files'],
    phase: 'planned',
    icon: 'privacy',
  },
  {
    id: 'creative-studio',
    title: 'Creative Studio',
    description: 'Helps you make art without sight.',
    group: 'Vision',
    tag: 'blind & low vision',
    input: 'screen + audio',
    inputs: ['screen', 'audio-out'],
    phase: 'built',
    icon: 'creative',
  },
  {
    id: 'colorblind-contrast',
    title: 'Color & Contrast',
    description: 'Fixes colors that are hard to tell apart.',
    group: 'Color Vision',
    tag: 'color vision deficiency',
    input: 'screen',
    inputs: ['screen'],
    phase: 'built',
    icon: 'colour',
  },
  {
    id: 'live-captions',
    title: 'Live Captions',
    description: 'Turns speech into text on screen.',
    group: 'Hearing',
    tag: 'deaf & hard of hearing',
    input: 'microphone',
    inputs: ['microphone'],
    phase: 'built',
    icon: 'hearing',
  },
  {
    id: 'simplify-text',
    title: 'Simplify Text',
    description: 'Makes hard text easier to read.',
    group: 'Dyslexia, ADHD & Cognitive',
    tag: 'dyslexia, ADHD & cognitive',
    input: 'screen',
    inputs: ['screen'],
    phase: 'partial',
    icon: 'simplify',
  },
  {
    id: 'input-assist',
    title: 'Input Assist',
    description: 'Makes your mouse and keys easier to use.',
    group: 'Dexterity',
    tag: 'motor & dexterity',
    input: 'os-input',
    inputs: ['os-input'],
    phase: 'planned',
    icon: 'motor',
  },
  {
    id: 'conversation-coach',
    title: 'Conversation Coach',
    description: 'Helps you keep up in conversations.',
    group: 'Autism',
    tag: 'autism',
    input: 'camera + microphone',
    inputs: ['camera', 'microphone'],
    phase: 'built',
    icon: 'social',
  },
  {
    id: 'flash-filter',
    title: 'Flash Filter',
    description: 'Dims dangerous flashing.',
    group: 'Epilepsy',
    tag: 'photosensitive epilepsy',
    input: 'screen',
    inputs: ['screen'],
    phase: 'built',
    icon: 'photo',
  },
];
