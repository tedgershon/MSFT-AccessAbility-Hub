/**
 * Simplify Text service — dyslexia, ADHD & cognitive accessibility.
 *
 * Screen-text transform engine: the shell (or a user shortcut) emits
 * `simplifyText/request` with the selected text; this service transforms it and
 * re-injects the result in-place via the shared input multiplexer (`input/intent`).
 *
 * Modes (Strategy pattern, switchable via `simplifyText.mode` config key):
 *   simplify   — MTCAI (Georgia Tech CIDI, issue #18): plain-language reduction
 *                for health portals, forms, and complex on-screen text.
 *   restructure — NAPE (CMU VariAbility Lab, issue #20): reformat learning
 *                 materials to cognitive style (ADHD / dyslexia / autism).
 *
 * Declares `commandChannel: exclusive` because Scout (ClawPilot) drives the
 * in-place text replacement and only one service may hold that channel at a time.
 * This is fundamentally different from colorblind-contrast: this service modifies
 * content, not display rendering.
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

  // commandChannel: exclusive — only one service drives Scout text replacement.
  readonly requires: Capability[] = [cap('commandChannel', 'exclusive')];

  #ctx?: ServiceContext;
  #strategy: TransformStrategy = STRATEGIES.simplify;
  #active = false;
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
    // Subscribe to transform requests. The shell or a global shortcut emits
    // `simplifyText/request` with the user-selected text; we transform and
    // re-inject via the input multiplexer so the OS sees it as keyboard input.
    this.#unsubscribe = ctx.bus.on('simplifyText/request', ({ text }) => {
      const transformed = this.#strategy.transform(text);
      // Route through the input multiplexer — never inject directly (hard rule #5).
      ctx.bus.emit('input/intent', {
        source: ctx.selfId,
        kind: 'keyboard',
        payload: { text: transformed },
      });
      ctx.bus.emit('simplifyText/result', {
        original: text,
        transformed,
        mode: this.#strategy.id,
      });
    });
  }

  async onDisable(): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#active = false;
  }

  async onUnload(): Promise<void> {
    this.#ctx = undefined;
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx) return degraded('not loaded');
    return healthy(this.#active ? `active (${this.#strategy.id})` : 'idle');
  }
}
