/**
 * Renderer entry — pure browser code. Imports NOTHING from `electron` or Node; it
 * talks to the main process only through the typed `window.hub` bridge that the
 * preload exposes ({@link HubBridge}).
 *
 * Responsibilities:
 *  - paint the service list (name, phase, health) with an enable/disable toggle;
 *  - paint the overlay layers using the PURE {@link describeOverlayLayer} helper;
 *  - re-render whenever the main process pushes a fresh snapshot.
 */

import type {
  HubBridge,
  OverlayLayerView,
  ServiceView,
  SpeakRequest,
} from '../src/ui/ipc-contract.js';
import { describeOverlayLayer } from '../src/ui/view-model.js';

declare global {
  interface Window {
    hub: HubBridge;
  }
}

const serviceList = document.getElementById('service-list') as HTMLUListElement;
const overlayList = document.getElementById('overlay-list') as HTMLUListElement;

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function renderServices(views: ServiceView[]): void {
  clear(serviceList);

  if (views.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No services registered.';
    serviceList.appendChild(empty);
    return;
  }

  for (const view of views) {
    const row = document.createElement('li');
    row.className = 'service-row';

    const meta = document.createElement('div');
    meta.className = 'meta';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = view.name;

    const sub = document.createElement('span');
    sub.className = 'sub';
    const dot = document.createElement('span');
    dot.className = `health-dot health-${view.health.state}`;
    sub.appendChild(dot);
    const detail = view.health.detail ? ` — ${view.health.detail}` : '';
    sub.appendChild(
      document.createTextNode(`${view.phase} · ${view.health.state}${detail}`),
    );

    meta.append(name, sub);

    const enabled = view.phase === 'enabled';
    const toggle = document.createElement('button');
    toggle.className = 'toggle';
    toggle.dataset.enabled = String(enabled);
    toggle.textContent = enabled ? 'Disable' : 'Enable';
    toggle.addEventListener('click', () => {
      void (enabled ? window.hub.disable(view.id) : window.hub.enable(view.id));
    });

    row.append(meta, toggle);
    serviceList.appendChild(row);
  }
}

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
  } else if (view.kind === 'caption') {
    const caption = document.createElement('div');
    caption.className = 'overlay-caption';
    caption.textContent = descriptor.label || '…';
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

window.hub.onSpeak((req: SpeakRequest) => {
  if (describeStatus) describeStatus.textContent = req.text;
  if (typeof speechSynthesis === 'undefined') return;
  const utterance = new SpeechSynthesisUtterance(req.text);
  if (req.rate !== undefined) utterance.rate = req.rate;
  if (req.pitch !== undefined) utterance.pitch = req.pitch;
  if (req.voice) {
    const voice = speechSynthesis.getVoices().find((v) => v.name === req.voice);
    if (voice) utterance.voice = voice;
  }
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
});

window.hub.onSpeakCancel(() => {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
});

// Paint an empty state immediately; the main process pushes a snapshot on load.
renderServices([]);
renderOverlay([]);
