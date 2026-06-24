/**
 * Overlay Surface — host-side consumer of the shared overlay render channel.
 *
 * Several tiles (color correction, live captions, screen dim, ...) need to put
 * something on screen. Rather than each reaching for the DOM, they emit generic
 * `overlay/attach` / `overlay/update` / `overlay/detach` events; this surface is the
 * single host-side consumer that keeps an in-memory registry of active layers.
 *
 * Intentionally DOM-free: the real Electron renderer will later read {@link layers}
 * and paint it. Keeping the registry here makes the channel headless-testable.
 */

import type { EventBus, OverlayLayer } from '@aah/contracts';

export class OverlaySurface {
  readonly #layers = new Map<string, OverlayLayer>();
  readonly #subscriptions: Array<() => void> = [];

  /**
   * Subscribe to the overlay topics on the bus. Call once at hub bootstrap.
   * `attach` adds/replaces a layer, `update` mutates an existing one (no upsert so
   * a stale update can't resurrect a detached layer), `detach` removes it by id.
   */
  mount(bus: EventBus): void {
    this.#subscriptions.push(
      bus.on('overlay/attach', (layer) => {
        this.#layers.set(layer.id, layer);
      }),
      bus.on('overlay/update', (layer) => {
        if (this.#layers.has(layer.id)) this.#layers.set(layer.id, layer);
      }),
      bus.on('overlay/detach', ({ id }) => {
        this.#layers.delete(id);
      }),
    );
  }

  /** Release every bus subscription and drop all layers. */
  unmount(): void {
    for (const off of this.#subscriptions.splice(0)) off();
    this.#layers.clear();
  }

  /** Active layers, in attach order — what a renderer would paint. */
  layers(): OverlayLayer[] {
    return [...this.#layers.values()];
  }

  /** Look up a single active layer by id. */
  get(id: string): OverlayLayer | undefined {
    return this.#layers.get(id);
  }
}
