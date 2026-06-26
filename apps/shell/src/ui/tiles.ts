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
 * A category icon key. Drives the tinted icon tile (colour + glyph) so users locate
 * aids by shape + colour, not by reading alone (recognition over recall).
 */
export type TileIcon =
  | 'vision'
  | 'colour'
  | 'hearing'
  | 'cognitive'
  | 'motor'
  | 'social'
  | 'photo';

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
  'Colour vision',
  'Hearing',
  'Cognitive',
  'Motor & dexterity',
  'Social / autism',
  'Photosensitivity',
];

/**
 * The aids to surface. Source of truth: issue #1's pinned catalog + the `services/`
 * tree. Render every tile — including `partial` / `planned` ones — never hide them.
 */
export const TILE_CATALOG: readonly TileDef[] = [
  {
    id: 'scene-describer',
    title: 'Scene Describer',
    description: 'Narrates what the camera sees — snapshot describe plus point/gaze announce.',
    group: 'Vision',
    tag: 'blind & low vision',
    input: 'camera',
    phase: 'partial',
    icon: 'vision',
  },
  {
    id: 'privacy-guard',
    title: 'Privacy Guard',
    description: 'Scans images and screen before sharing and warns about private visual content.',
    group: 'Vision',
    tag: 'blind & low vision',
    input: 'camera / files',
    phase: 'planned',
    icon: 'vision',
  },
  {
    id: 'creative-studio',
    title: 'Creative Studio',
    description: 'Mediates creative apps for blind and low-vision users — narrates state, automates steps.',
    group: 'Vision',
    tag: 'blind & low vision',
    input: 'screen + audio',
    phase: 'built',
    icon: 'vision',
  },
  {
    id: 'colorblind-contrast',
    title: 'Color & Contrast',
    description: 'Real-time colour and contrast correction as a display overlay.',
    group: 'Colour vision',
    tag: 'color vision deficiency',
    input: 'screen',
    phase: 'built',
    icon: 'colour',
  },
  {
    id: 'live-captions',
    title: 'Live Captions',
    description: 'Turns system and mic audio into live captions plus non-speech sound alerts.',
    group: 'Hearing',
    tag: 'deaf & hard of hearing',
    input: 'microphone',
    phase: 'built',
    icon: 'hearing',
  },
  {
    id: 'simplify-text',
    title: 'Simplify Text',
    description: 'Reads complex on-screen text and re-injects a simplified version in place.',
    group: 'Cognitive',
    tag: 'dyslexia, ADHD & cognitive',
    input: 'screen',
    phase: 'partial',
    icon: 'cognitive',
  },
  {
    id: 'input-assist',
    title: 'Input Assist',
    description: 'Cursor magnification and target-assist plus input remapping.',
    group: 'Motor & dexterity',
    tag: 'motor & dexterity',
    input: 'os-input',
    phase: 'planned',
    icon: 'motor',
  },
  {
    id: 'conversation-coach',
    title: 'Conversation Coach',
    description: 'On calls, privately surfaces repair prompts from camera and audio.',
    group: 'Social / autism',
    tag: 'autism',
    input: 'camera + microphone',
    phase: 'built',
    icon: 'social',
  },
  {
    id: 'flash-filter',
    title: 'Flash Filter',
    description: 'Detects seizure-triggering flashing and dims or filters it in real time.',
    group: 'Photosensitivity',
    tag: 'photosensitive epilepsy',
    input: 'screen',
    phase: 'built',
    icon: 'photo',
  },
];
