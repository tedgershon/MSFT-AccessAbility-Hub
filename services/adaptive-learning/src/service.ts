/**
 * Adaptive Learning service (NAPE — adaptive learning materials).
 *
 * Reads on-screen learning text and re-injects a version restructured for the
 * reader's cognitive style (ADHD / dyslexia / autism). Like the colorblind tile it
 * is a pure display overlay — no process, no camera — so it declares only
 * `displayOverlay: shared` and conflicts with nothing (Interface Segregation:
 * declare only what you touch). Uses the Strategy pattern to swap restructuring
 * algorithms.
 *
 * Part of the shared "Simplify Text" screen-transform tile (epic): read on-screen
 * text → transform → re-inject. This service is the Restructure-for-cognitive-style
 * mode.
 */

import {
  type AccessibilityService,
  type Capability,
  cap,
  degraded,
  type HealthStatus,
  healthy,
  type ServiceContext,
  type ServiceMeta,
} from '@aah/contracts';
import {
  DEFAULT_STYLE_ID,
  STRATEGIES,
  type CognitiveStyleStrategy,
} from './strategies.js';

export class AdaptiveLearningService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'adaptive-learning',
    name: 'Adaptive Learning Materials (NAPE)',
    version: '0.1.0',
  };

  readonly requires: Capability[] = [cap('displayOverlay', 'shared')];

  #ctx?: ServiceContext;
  #strategy: CognitiveStyleStrategy = STRATEGIES[DEFAULT_STYLE_ID];
  #active = false;

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    const configured = ctx.config.get<string>('adaptive-learning.style');
    if (configured && STRATEGIES[configured]) this.#strategy = STRATEGIES[configured];
  }

  async onEnable(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx) return;
    // Mount the restructuring layer on the shared overlay surface. The host-side
    // OverlaySurface keys layers by id; the renderer reads on-screen learning text
    // and paints the restructured version in place.
    this.#active = true;
    ctx.bus.emit('overlay/attach', {
      id: this.#layerId,
      ownerId: ctx.selfId,
      kind: 'adaptive-text',
      params: { style: this.#strategy.id },
    });
  }

  async onDisable(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx || !this.#active) return;
    // Tear the restructuring layer off the overlay surface.
    this.#active = false;
    ctx.bus.emit('overlay/detach', { id: this.#layerId, ownerId: ctx.selfId });
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx) return degraded('not loaded');
    return healthy(this.#active ? `overlay active (${this.#strategy.id})` : 'idle');
  }

  /**
   * Restructure a block of on-screen learning text for the active cognitive style.
   * Exposed so the host renderer (or tests) can transform captured screen text
   * without reaching into the strategy registry.
   */
  restructure(text: string): string {
    return this.#strategy.restructure(text);
  }

  /** The active cognitive-style strategy id (e.g. `'adhd'`). */
  get activeStyle(): string {
    return this.#strategy.id;
  }

  /** Stable id for this service's single overlay layer. */
  get #layerId(): string {
    return `${this.meta.id}:restructure`;
  }
}
