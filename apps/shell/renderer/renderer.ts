/**
 * Renderer entry — pure browser code. Imports NOTHING from `electron` or Node; it
 * talks to the main process only through the typed `window.hub` bridge that the
 * preload exposes ({@link HubBridge}).
 *
 * Responsibilities:
 *  - apply persisted appearance settings on load (before painting content);
 *  - paint the tile-based home grid (grouped, searchable, filterable, pinnable),
 *    merging the catalog with the live service snapshot via PURE view-models;
 *  - wire each tile's toggle to `window.hub` enable/disable;
 *  - paint the secondary overlay-layers diagnostics + voice describe output;
 *  - re-render whenever the main process pushes a fresh snapshot.
 *
 * All non-trivial logic lives in the co-located, DOM-free view-models
 * (`../src/ui/*.ts`); this file is a thin DOM-painter that calls them.
 */

import type {
  HubBridge,
  OverlayLayerView,
  ServiceView,
  SpeakRequest,
} from '../src/ui/ipc-contract.js';
import { describeOverlayLayer } from '../src/ui/view-model.js';
import { TILE_CATALOG, type InputSource, type TileIcon } from '../src/ui/tiles.js';
import {
  PINNED_GROUP_TITLE,
  tilesViewModel,
  type TileGroupView,
  type TileView,
} from '../src/ui/tiles-view-model.js';
import {
  defaultSettings,
  parseSettings,
  resolveAppearance,
  serializeSettings,
  togglePinned,
  type HubSettings,
  type SystemPrefs,
} from '../src/ui/settings.js';

declare global {
  interface Window {
    hub: HubBridge;
  }
}

const SETTINGS_KEY = 'aah:settings';
const VISITED_KEY = 'aah:visited';

// --- Appearance: read system prefs + persisted settings, apply BEFORE painting. ---

function readSystemPrefs(): SystemPrefs {
  const match = (q: string): boolean =>
    typeof matchMedia === 'function' && matchMedia(q).matches;
  return {
    prefersDark: match('(prefers-color-scheme: dark)'),
    prefersReducedMotion: match('(prefers-reduced-motion: reduce)'),
    prefersHighContrast: match('(prefers-contrast: more)'),
  };
}

function readSettings(prefs: SystemPrefs): HubSettings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY), prefs);
  } catch {
    return defaultSettings(prefs);
  }
}

function persistSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, serializeSettings(settings));
  } catch {
    /* storage may be unavailable; appearance still applies for the session. */
  }
}

function applyAppearance(): void {
  const a = resolveAppearance(settings, systemPrefs);
  const root = document.documentElement;
  root.dataset.theme = a.theme;
  root.dataset.textSize = a.textSize;
  root.dataset.contrast = a.contrast;
  root.dataset.motion = a.motion;
}

const systemPrefs = readSystemPrefs();
let settings = readSettings(systemPrefs);
applyAppearance();

// --- Live state pushed over the bridge / driven by header controls. ---

let servicesSnapshot: ServiceView[] = [];
let search = '';
let tagFilter: string | null = null;

// --- DOM handles. ---

const grid = document.getElementById('tile-grid') as HTMLDivElement;
const gridStatus = document.getElementById('grid-status');
const searchInput = document.getElementById('search') as HTMLInputElement;
const tagSelect = document.getElementById('tag-filter') as HTMLSelectElement;
const activeFilters = document.getElementById('active-filters') as HTMLDivElement;
const customizeButton = document.getElementById('customize-button') as HTMLButtonElement;
const customizePanel = document.getElementById('customize-panel') as HTMLElement;
const customizeBackdrop = document.getElementById('customize-backdrop') as HTMLDivElement;
const customizeDone = document.getElementById('customize-done') as HTMLButtonElement;
const stepsModal = document.getElementById('steps-modal') as HTMLElement;
const stepsBackdrop = document.getElementById('steps-backdrop') as HTMLDivElement;
const stepsTitle = document.getElementById('steps-title') as HTMLHeadingElement;
const stepsCount = document.getElementById('steps-count') as HTMLParagraphElement;
const stepsBody = document.getElementById('steps-body') as HTMLDivElement;
const stepsBack = document.getElementById('steps-back') as HTMLButtonElement;
const stepsNext = document.getElementById('steps-next') as HTMLButtonElement;
const stepsClose = document.getElementById('steps-close') as HTMLButtonElement;
const overlayList = document.getElementById('overlay-list') as HTMLUListElement;

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// --- Category icons (inline SVG; recognition over recall). ---

const ICON_PATHS: Record<TileIcon, string[]> = {
  vision: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  colour: ['M12 3s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11z'],
  hearing: ['M4 9v6h4l5 4V5L8 9H4z', 'M16 8a4 4 0 0 1 0 8'],
  cognitive: ['M12 3a6 6 0 0 0-4 10c.7.7 1 1.6 1 2.5h6c0-.9.3-1.8 1-2.5A6 6 0 0 0 12 3z', 'M10 21h4'],
  motor: ['M5 3l6 16 2.5-6.5L20 10 5 3z'],
  social: ['M4 5h16v10H8l-4 4V5z'],
  photo: ['M13 2L4 14h6l-1 8 9-12h-6l1-8z'],
  // Aid-specific glyphs (more descriptive than the bare category icon).
  describe: ['M3 8a2 2 0 0 1 2-2h1.2l1-1.6h5.6l1 1.6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M12 9.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  privacy: ['M12 3l7 2.5V11c0 4.6-3 7.7-7 8.7-4-1-7-4.1-7-8.7V5.5z', 'M9 11.7l2 2 4-4'],
  creative: ['M12 3a9 8 0 0 0 0 16c1.1 0 2-.9 2-2 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.3 0-.8.7-1.5 1.5-1.5H16a4 4 0 0 0 4-4c0-4-3.6-6-8-6z', 'M7.5 11h.01', 'M10 8h.01', 'M14 8h.01'],
  simplify: ['M5 6h14', 'M5 10h14', 'M5 14h9', 'M5 18h6'],
};

// Input-source emoji tags (recognition over recall) + one-word hover/label text.
const INPUT_META: Record<InputSource, { emoji: string; label: string }> = {
  camera: { emoji: '\u{1F4F7}', label: 'camera' },
  microphone: { emoji: '\u{1F3A4}', label: 'microphone' },
  screen: { emoji: '\u{1F5A5}\u{FE0F}', label: 'screen' },
  'os-input': { emoji: '\u2328\u{FE0F}', label: 'keyboard' },
  files: { emoji: '\u{1F4C1}', label: 'files' },
  'audio-out': { emoji: '\u{1F50A}', label: 'speakers' },
};

const CATALOG_BY_ID = new Map(TILE_CATALOG.map((d) => [d.id, d]));

// --- Setup walkthrough: short, one-at-a-time steps shown in a slider dialog. ---

const SETUP_STEPS: Record<string, string[]> = {
  'scene-describer': [
    'Allow camera access when Windows asks.',
    'Point your camera at what you want described.',
    'Press Enable again to start narration.',
  ],
  'simplify-text': [
    'Open the page or document you want to simplify.',
    'Allow screen-reading access when prompted.',
    'Press Enable again to simplify the text on screen.',
  ],
  'live-captions': [
    'Allow microphone access when Windows asks.',
    'Pick the microphone you want to caption.',
    'Press Enable again to start live captions.',
  ],
  'conversation-coach': [
    'Allow camera and microphone access when asked.',
    'Join your call as you normally would.',
    'Press Enable again to get private prompts.',
  ],
};

const GENERIC_SETUP = [
  'Grant the permissions this aid needs when prompted.',
  'Press Enable again to finish turning it on.',
];

function getSetupSteps(id: string): string[] {
  return SETUP_STEPS[id] ?? GENERIC_SETUP;
}

// A small, reusable steps dialog. Used for setup walkthroughs (multi-step) and for
// the "coming soon" notice (single step). One step shows at a time to keep the
// cognitive load low.
let stepsState: { steps: string[]; index: number; lastLabel: string } | null = null;
let stepsOpener: HTMLElement | null = null;

function renderSteps(): void {
  if (!stepsState) return;
  const { steps, index, lastLabel } = stepsState;
  const multi = steps.length > 1;
  stepsBody.textContent = steps[index];
  stepsCount.textContent = multi ? `Step ${index + 1} of ${steps.length}` : '';
  stepsCount.hidden = !multi;
  stepsBack.hidden = !multi;
  stepsBack.disabled = index === 0;
  const last = index === steps.length - 1;
  stepsNext.textContent = last ? lastLabel : 'Next';
}

function openSteps(
  title: string,
  steps: string[],
  opener: HTMLElement,
  lastLabel = 'Done',
): void {
  stepsState = { steps, index: 0, lastLabel };
  stepsOpener = opener;
  stepsTitle.textContent = title;
  renderSteps();
  stepsModal.hidden = false;
  stepsBackdrop.hidden = false;
  stepsNext.focus();
}

function closeSteps(): void {
  stepsModal.hidden = true;
  stepsBackdrop.hidden = true;
  stepsState = null;
  stepsOpener?.focus();
  stepsOpener = null;
}

stepsBack.addEventListener('click', () => {
  if (!stepsState || stepsState.index === 0) return;
  stepsState.index -= 1;
  renderSteps();
});

stepsNext.addEventListener('click', () => {
  if (!stepsState) return;
  if (stepsState.index >= stepsState.steps.length - 1) {
    closeSteps();
    return;
  }
  stepsState.index += 1;
  renderSteps();
});

stepsClose.addEventListener('click', closeSteps);
stepsBackdrop.addEventListener('click', closeSteps);

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeIcon(icon: TileIcon): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICON_PATHS[icon]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

// --- Tile rendering. ---

function makePinButton(tile: TileView): HTMLButtonElement {
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'tile__pin';
  pin.setAttribute('aria-pressed', String(tile.pinned));
  pin.setAttribute('aria-label', `${tile.pinned ? 'Unpin' : 'Pin'} ${tile.title}`);
  pin.textContent = tile.pinned ? '\u2605' : '\u2606';
  pin.addEventListener('click', () => {
    settings = togglePinned(settings, tile.id);
    persistSettings();
    renderGrid();
  });
  return pin;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function makeFooter(tile: TileView): HTMLDivElement {
  const footer = document.createElement('div');
  footer.className = 'tile__footer';

  // Left: a status line that only appears once the aid is on. When enabled and
  // healthy it reads "Enabled" with a green dot; a degraded/unhealthy aid surfaces
  // that state instead. A disabled aid shows nothing (keeps the card calm).
  const statusWrap = document.createElement('div');
  statusWrap.className = 'tile__statuswrap';

  if (tile.status === 'available' && tile.enabled) {
    const state = tile.health?.state ?? 'healthy';
    const status = document.createElement('span');
    status.className = 'tile__status';
    const dot = document.createElement('span');
    dot.className = `health-dot health-${state}`;
    status.appendChild(dot);
    status.appendChild(
      document.createTextNode(state === 'healthy' ? 'Enabled' : capitalize(state)),
    );
    statusWrap.appendChild(status);
  }
  footer.appendChild(statusWrap);

  // Right: a single, uniform "Enable" button on every tile. What a click does
  // depends on the tile: an available aid toggles on/off live; a setup-needed aid
  // opens a step-by-step setup walkthrough; a coming-soon aid opens a short notice.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toggle';

  if (tile.status === 'available') {
    toggle.dataset.enabled = String(tile.enabled);
    toggle.textContent = tile.enabled ? 'Disable' : 'Enable';
    toggle.addEventListener('click', () => {
      void (tile.enabled ? window.hub.disable(tile.id) : window.hub.enable(tile.id));
    });
  } else if (tile.status === 'setup-needed') {
    toggle.dataset.enabled = 'false';
    toggle.textContent = 'Enable';
    toggle.addEventListener('click', () => {
      openSteps(`Set up ${tile.title}`, getSetupSteps(tile.id), toggle);
    });
  } else {
    // coming-soon
    toggle.dataset.enabled = 'false';
    toggle.textContent = 'Enable';
    toggle.addEventListener('click', () => {
      openSteps(tile.title, ['This aid is coming soon \u2014 check back later.'], toggle, 'Got it');
    });
  }
  footer.appendChild(toggle);

  return footer;
}

function makeInputChips(tile: TileView): HTMLDivElement | null {
  const def = CATALOG_BY_ID.get(tile.id);
  if (!def || def.inputs.length === 0) return null;

  const row = document.createElement('div');
  row.className = 'tile__inputs';
  for (const source of def.inputs) {
    const meta = INPUT_META[source];
    const chip = document.createElement('span');
    chip.className = 'input-chip';
    chip.textContent = meta.emoji;
    chip.title = meta.label;
    chip.setAttribute('role', 'img');
    chip.setAttribute('aria-label', meta.label);
    row.appendChild(chip);
  }
  return row;
}

function renderTile(tile: TileView): HTMLElement {
  const card = document.createElement('article');
  card.className = 'tile';
  card.dataset.status = tile.status;

  const head = document.createElement('div');
  head.className = 'tile__head';

  const iconBox = document.createElement('span');
  iconBox.className = `tile-icon tile-icon--${tile.icon}`;
  iconBox.appendChild(makeIcon(tile.icon));

  head.append(iconBox, makePinButton(tile));

  const title = document.createElement('h3');
  title.className = 'tile__title';
  title.textContent = tile.title;

  const desc = document.createElement('p');
  desc.className = 'tile__desc';
  desc.textContent = tile.description;

  card.append(head, title, desc, makeFooter(tile));
  const inputs = makeInputChips(tile);
  if (inputs) card.appendChild(inputs);
  return card;
}

function makeCellLabel(group: TileGroupView, index: number): HTMLElement {
  const heading = document.createElement('h2');
  heading.className = 'cell__label';
  heading.id = `tile-group-${index}`;
  if (group.title === PINNED_GROUP_TITLE) {
    const star = document.createElement('span');
    star.setAttribute('aria-hidden', 'true');
    star.textContent = '\u2605 ';
    heading.append(star, document.createTextNode('Pinned'));
  } else {
    heading.textContent = group.title;
  }
  return heading;
}

// One flat grid: every tile is a cell that flows next to the others regardless of
// category. The category label lives in the cell of its FIRST tile (in the reserved
// label row directly above the card), so a single visual row can carry several
// category labels at once.
function renderGroupCells(group: TileGroupView, index: number): HTMLElement[] {
  return group.tiles.map((tile, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (i === 0) cell.appendChild(makeCellLabel(group, index));
    cell.appendChild(renderTile(tile));
    return cell;
  });
}

let tagControlsBuilt = false;

function renderGrid(): void {
  const view = tilesViewModel({
    catalog: TILE_CATALOG,
    services: servicesSnapshot,
    search,
    tagFilter,
    pinned: settings.pinned,
  });

  if (!tagControlsBuilt) {
    buildTagControls(view.tags);
    tagControlsBuilt = true;
  }

  clear(grid);
  if (view.total === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No aids match your search.';
    grid.appendChild(empty);
  } else {
    view.groups.forEach((group, i) => {
      for (const cell of renderGroupCells(group, i)) grid.appendChild(cell);
    });
  }

  if (gridStatus) {
    gridStatus.textContent = `${view.total} ${view.total === 1 ? 'aid' : 'aids'} shown.`;
  }
}

// --- Search + tag filter, with active selections shown as chips in the banner. ---

function setTagFilter(next: string | null): void {
  tagFilter = next;
  tagSelect.value = next ?? '';
  renderActiveFilters();
  renderGrid();
}

function buildTagControls(tags: readonly string[]): void {
  clear(tagSelect);
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All needs';
  tagSelect.appendChild(all);
  for (const tag of tags) {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag;
    tagSelect.appendChild(opt);
  }
  tagSelect.value = tagFilter ?? '';
}

function makeFilterChip(label: string, clearLabel: string, onClear: () => void): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'filter-chip';
  chip.setAttribute('aria-label', `${clearLabel}: ${label}`);
  const text = document.createElement('span');
  text.textContent = label;
  const x = document.createElement('span');
  x.className = 'filter-chip__x';
  x.setAttribute('aria-hidden', 'true');
  x.textContent = '\u2715';
  chip.append(text, x);
  chip.addEventListener('click', onClear);
  return chip;
}

function renderActiveFilters(): void {
  clear(activeFilters);
  const query = search.trim();
  if (query) {
    activeFilters.appendChild(
      makeFilterChip(`\u201C${query}\u201D`, 'Clear search', () => {
        search = '';
        searchInput.value = '';
        renderActiveFilters();
        renderGrid();
      }),
    );
  }
  if (tagFilter) {
    activeFilters.appendChild(
      makeFilterChip(tagFilter, 'Clear filter', () => setTagFilter(null)),
    );
  }
}

searchInput.addEventListener('input', () => {
  search = searchInput.value;
  renderActiveFilters();
  renderGrid();
});

tagSelect.addEventListener('change', () => {
  setTagFilter(tagSelect.value === '' ? null : tagSelect.value);
});

// --- Customization modal: radios bound to the persisted settings object. ---

let modalOpener: HTMLElement | null = null;

function openCustomize(): void {
  customizePanel.hidden = false;
  customizeBackdrop.hidden = false;
  customizeButton.setAttribute('aria-expanded', 'true');
  const first = customizePanel.querySelector<HTMLInputElement>('input[type="radio"]');
  first?.focus();
}

function closeCustomize(): void {
  customizePanel.hidden = true;
  customizeBackdrop.hidden = true;
  customizeButton.setAttribute('aria-expanded', 'false');
  (modalOpener ?? customizeButton).focus();
}

customizeButton.addEventListener('click', () => {
  modalOpener = customizeButton;
  if (customizePanel.hidden) openCustomize();
  else closeCustomize();
});

customizeDone.addEventListener('click', closeCustomize);
customizeBackdrop.addEventListener('click', closeCustomize);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!stepsModal.hidden) closeSteps();
  else if (!customizePanel.hidden) closeCustomize();
});

function syncCustomizeControls(): void {
  const set = (name: keyof HubSettings, value: string): void => {
    const input = customizePanel.querySelector<HTMLInputElement>(
      `input[name="${name}"][value="${value}"]`,
    );
    if (input) input.checked = true;
  };
  set('textSize', settings.textSize);
  set('theme', settings.theme);
  set('contrast', settings.contrast);
  set('motion', settings.motion);
}

customizePanel.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  if (input.type !== 'radio' || !input.checked) return;
  const name = input.name as 'textSize' | 'theme' | 'contrast' | 'motion';
  settings = { ...settings, [name]: input.value } as HubSettings;
  persistSettings();
  applyAppearance();
});

syncCustomizeControls();

// First visit only: greet the user with the customization modal so they can set a
// comfortable baseline before the grid. Any later visit skips it (the flag persists).
function isFirstVisit(): boolean {
  try {
    return localStorage.getItem(VISITED_KEY) === null;
  } catch {
    return false;
  }
}

function markVisited(): void {
  try {
    localStorage.setItem(VISITED_KEY, '1');
  } catch {
    /* storage may be unavailable; the modal simply won't auto-open next time. */
  }
}

if (isFirstVisit()) {
  markVisited();
  openCustomize();
}

// --- Overlay-layer diagnostics (secondary surface). ---

function renderOverlayRow(view: OverlayLayerView): HTMLLIElement {
  const descriptor = describeOverlayLayer(view);
  const row = document.createElement('li');
  row.className = 'overlay-row';

  const kind = document.createElement('div');
  kind.className = 'kind';
  kind.textContent = descriptor.kind;

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = descriptor.label || '(no content)';

  row.append(kind, label);

  if (view.kind === 'color-correction') {
    const preview = document.createElement('div');
    preview.className = 'overlay-preview';
    if (descriptor.style?.filter) preview.style.filter = descriptor.style.filter;
    row.appendChild(preview);
  } else if (view.kind === 'flash-guard') {
    const preview = document.createElement('div');
    preview.className = 'overlay-preview';
    // The protective dim: a black swatch whose alpha tracks the flash intensity.
    if (descriptor.style?.backgroundColor) {
      preview.style.backgroundColor = descriptor.style.backgroundColor;
    }
    row.appendChild(preview);
  } else if (view.kind === 'caption') {
    const caption = document.createElement('div');
    caption.className = 'overlay-caption';
    caption.textContent = descriptor.label || '\u2026';
    row.appendChild(caption);
  } else {
    const chip = document.createElement('span');
    chip.className = 'overlay-chip';
    chip.textContent = descriptor.kind;
    row.appendChild(chip);
  }

  return row;
}

function renderOverlay(views: OverlayLayerView[]): void {
  clear(overlayList);

  if (views.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No active overlay layers.';
    overlayList.appendChild(empty);
    return;
  }

  for (const view of views) overlayList.appendChild(renderOverlayRow(view));
}

function renderServices(views: ServiceView[]): void {
  servicesSnapshot = views;
  renderGrid();
}

window.hub.onServices(renderServices);
window.hub.onOverlay(renderOverlay);


// Screen-description tile: trigger capture + describe, and voice the result via the
// Web Speech API (kept in the renderer; the main process has no audio output path).
const describeButton = document.getElementById('describe-button') as HTMLButtonElement | null;
const describeStatus = document.getElementById('describe-status');

describeButton?.addEventListener('click', () => {
  if (describeStatus) describeStatus.textContent = "Describing what's on screen\u2026";
  void window.hub.describe();
});

function speakRequest(req: SpeakRequest): void {
  if (describeStatus) describeStatus.textContent = req.text;
  if (typeof speechSynthesis === 'undefined') return;

  const utterance = new SpeechSynthesisUtterance(req.text);
  if (req.rate !== undefined) utterance.rate = req.rate;
  if (req.pitch !== undefined) utterance.pitch = req.pitch;
  utterance.onerror = (event) => {
    console.error('[renderer] speech synthesis error:', event.error);
  };

  const start = (): void => {
    const voices = speechSynthesis.getVoices();
    const voice = req.voice
      ? voices.find((v) => v.name === req.voice)
      : (voices.find((v) => v.default) ?? voices[0]);
    if (voice) utterance.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  };

  // Chromium/Electron load voices asynchronously; if none are ready yet, the first
  // speak() can be dropped. Wait once for `voiceschanged`, otherwise speak now.
  if (speechSynthesis.getVoices().length === 0) {
    speechSynthesis.addEventListener('voiceschanged', start, { once: true });
  } else {
    start();
  }
}

window.hub.onSpeak(speakRequest);

window.hub.onSpeakCancel(() => {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
});

// Paint an empty state immediately; the main process pushes a snapshot on load.
renderServices([]);
renderOverlay([]);
