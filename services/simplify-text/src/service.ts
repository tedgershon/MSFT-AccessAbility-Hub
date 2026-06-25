/**
 * Simplify Text service — dyslexia, ADHD & cognitive accessibility.
 *
 * When the user selects text and triggers a simplification request, this service
 * transforms it and surfaces the result as an overlay panel on top of the original
 * content — suitable for read-only text (health portals, articles, PDFs) where
 * in-place keyboard injection cannot replace content.
 *
 * Modes (Strategy pattern, switchable via `simplifyText.mode` config key):
 *   simplify    — MTCAI (Georgia Tech CIDI, issue #18): plain-language reduction
 *                 for health portals, forms, and complex on-screen text.
 *   restructure — NAPE (CMU VariAbility Lab, issue #20): reformat learning
 *                 materials to cognitive style (ADHD / dyslexia / autism).
 *
 * Declares `displayOverlay: shared` — the panel coexists with colorblind-contrast
 * and any other overlay tile. The renderer keys on `kind: 'text-simplification'`
 * to paint the panel UI; `params` carries the original and simplified text.
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
  #panelAttached = false;
  #unsubscribe?: () => void;

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    const configured = ctx.config.get<string>('simplifyText.mode');
    if (configured && STRATEGIES[configured]) this.#strategy = STRATEGIES[configured];
  }

  async onEnable(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx) return;
    this.#active = true;
    this.#unsubscribe = ctx.bus.on('simplifyText/request', ({ text }) => {
      const simplified = this.#strategy.transform(text);
      const layer = {
        id: this.#layerId,
        ownerId: ctx.selfId,
        kind: 'text-simplification',
        params: { mode: this.#strategy.id, original: text, simplified },
      };
      // First request: attach the panel. Subsequent requests: update it in place
      // so the renderer replaces the content without flickering.
      if (this.#panelAttached) {
        ctx.bus.emit('overlay/update', layer);
      } else {
        ctx.bus.emit('overlay/attach', layer);
        this.#panelAttached = true;
      }
    });
  }

  async onDisable(): Promise<void> {
    const ctx = this.#ctx;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    if (ctx && this.#panelAttached) {
      ctx.bus.emit('overlay/detach', { id: this.#layerId, ownerId: ctx.selfId });
      this.#panelAttached = false;
    }
    this.#active = false;
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx) return degraded('not loaded');
    return healthy(this.#active ? `panel active (${this.#strategy.id})` : 'idle');
  }

  get #layerId(): string {
    return `${this.meta.id}:panel`;
  }
}
