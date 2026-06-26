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
import { TILE_CATALOG, type TileIcon } from '../src/ui/tiles.js';
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
const customizeButton = document.getElementById('customize-button') as HTMLButtonElement;
const customizePanel = document.getElementById('customize-panel') as HTMLElement;
const onboarding = document.getElementById('onboarding') as HTMLElement;
const onboardingChips = document.getElementById('onboarding-chips') as HTMLDivElement;
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
};

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

function makeFooter(tile: TileView): HTMLDivElement {
  const footer = document.createElement('div');
  footer.className = 'tile__footer';

  const statusWrap = document.createElement('div');

  const status = document.createElement('span');
  status.className = 'tile__status';
  if (tile.available && tile.health) {
    const dot = document.createElement('span');
    dot.className = `health-dot health-${tile.health.state}`;
    status.appendChild(dot);
  }
  status.appendChild(document.createTextNode(tile.statusLabel));
  statusWrap.appendChild(status);

  if (tile.reason) {
    const reason = document.createElement('span');
    reason.className = 'tile__reason';
    reason.textContent = tile.reason;
    statusWrap.appendChild(reason);
  }

  footer.appendChild(statusWrap);

  if (tile.status === 'available') {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'toggle';
    toggle.dataset.enabled = String(tile.enabled);
    toggle.textContent = tile.enabled ? 'Disable' : 'Enable';
    toggle.addEventListener('click', () => {
      void (tile.enabled ? window.hub.disable(tile.id) : window.hub.enable(tile.id));
    });
    footer.appendChild(toggle);
  } else if (tile.status === 'setup-needed') {
    const setup = document.createElement('button');
    setup.type = 'button';
    setup.className = 'tile__action--setup';
    setup.textContent = 'Set up';
    setup.setAttribute('aria-label', `Set up ${tile.title}`);
    setup.disabled = true;
    footer.appendChild(setup);
  } else {
    const soon = document.createElement('span');
    soon.className = 'tile__action--disabled';
    soon.textContent = 'Coming soon';
    footer.appendChild(soon);
  }

  return footer;
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

  const tag = document.createElement('span');
  tag.className = 'tile__tag';
  tag.textContent = tile.tag;

  card.append(head, title, desc, tag, makeFooter(tile));
  return card;
}

function renderGroup(group: TileGroupView, index: number): HTMLElement {
  const section = document.createElement('section');
  section.className = 'tile-group';
  const headingId = `tile-group-${index}`;
  section.setAttribute('aria-labelledby', headingId);

  const heading = document.createElement('h2');
  heading.className = 'tile-group__heading';
  heading.id = headingId;
  if (group.title === PINNED_GROUP_TITLE) {
    const star = document.createElement('span');
    star.setAttribute('aria-hidden', 'true');
    star.textContent = '\u2605 ';
    heading.append(star, document.createTextNode('Pinned'));
  } else {
    heading.textContent = group.title;
  }
  section.appendChild(heading);

  const groupGrid = document.createElement('div');
  groupGrid.className = 'tile-group__grid';
  for (const tile of group.tiles) groupGrid.appendChild(renderTile(tile));
  section.appendChild(groupGrid);

  return section;
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
    view.groups.forEach((group, i) => grid.appendChild(renderGroup(group, i)));
  }

  if (gridStatus) {
    gridStatus.textContent = `${view.total} ${view.total === 1 ? 'aid' : 'aids'} shown.`;
  }
}

// --- Header controls: search, tag filter, need-first onboarding chips. ---

function setTagFilter(next: string | null): void {
  tagFilter = next;
  tagSelect.value = next ?? '';
  for (const chip of onboardingChips.querySelectorAll<HTMLButtonElement>('.need-chip')) {
    chip.setAttribute('aria-pressed', String((chip.dataset.tag ?? '') === (next ?? '')));
  }
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

  clear(onboardingChips);
  const allChip = makeNeedChip('All', '');
  onboardingChips.appendChild(allChip);
  for (const tag of tags) onboardingChips.appendChild(makeNeedChip(tag, tag));
  onboarding.hidden = false;
}

function makeNeedChip(label: string, tag: string): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'need-chip';
  chip.dataset.tag = tag;
  chip.textContent = label;
  chip.setAttribute('aria-pressed', String((tagFilter ?? '') === tag));
  chip.addEventListener('click', () => setTagFilter(tag === '' ? null : tag));
  return chip;
}

searchInput.addEventListener('input', () => {
  search = searchInput.value;
  renderGrid();
});

tagSelect.addEventListener('change', () => {
  setTagFilter(tagSelect.value === '' ? null : tagSelect.value);
});

// --- Customization panel: radios bound to the persisted settings object. ---

customizeButton.addEventListener('click', () => {
  const open = customizePanel.hidden;
  customizePanel.hidden = !open;
  customizeButton.setAttribute('aria-expanded', String(open));
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
