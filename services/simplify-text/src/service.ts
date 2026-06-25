/**
 * Simplify Text service — dyslexia, ADHD & cognitive accessibility.
 *
 * Shared screen-text transform engine: read on-screen text → transform → re-inject.
 * Modes: Simplify (health-literacy / MTCAI, issue #18) and Restructure for cognitive
 * style (ADHD/dyslexia/autism / NAPE, issue #20). Part of epic #32.
 *
 * Pure display overlay — no camera, no mic. Declares only `displayOverlay: shared`,
 * so it coexists with colorblind-contrast and any other overlay tile. Uses the
 * Strategy pattern to swap the transform algorithm at runtime.
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
import { STRATEGIES, type TransformStrategy } from './strategies.js';

export class SimplifyTextService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'simplify-text',
    name: 'Simplify Text',
    version: '0.1.0',
  };

  readonly requires: Capability[] = [cap('displayOverlay', 'shared')];

  #ctx?: ServiceContext;
  #strategy: TransformStrategy = STRATEGIES.simplify;
  #active = false;

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    const configured = ctx.config.get<string>('simplifyText.mode');
    if (configured && STRATEGIES[configured]) this.#strategy = STRATEGIES[configured];
  }

  async onEnable(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx) return;
    this.#active = true;
    ctx.bus.emit('overlay/attach', {
      id: this.#layerId,
      ownerId: ctx.selfId,
      kind: 'text-simplification',
      params: { mode: this.#strategy.id },
    });
  }

  async onDisable(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx || !this.#active) return;
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

  get #layerId(): string {
    return `${this.meta.id}:transform`;
  }
}
