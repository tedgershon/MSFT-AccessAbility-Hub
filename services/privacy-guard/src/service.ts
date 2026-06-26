/**
 * Privacy Guard — scan a share candidate (the screen) before it leaves the device.
 *
 * On request (a `privacy/scan-requested` event from the shell), it grabs a screenshot
 * via the injected display-capture adapter, turns it into a {@link ShareScene} with an
 * injected {@link ShareAnalyzer}, runs the pure {@link PrivacyGuard} detectors, then
 * — blind-first — paints the findings as an overlay panel AND speaks an alerting
 * summary through the TTS adapter, and finally emits a `privacy/verdict` so the shell
 * can hold the share and let the user decide. Serves blind & low-vision users who
 * can't visually audit what an image gives away.
 *
 * Declares only shared resources (displayOverlay + audioOut); both leases are released
 * on disable. It never drives input and never imports another service (hard rules).
 */

import {
  type AccessibilityService,
  cap,
  type Capability,
  degraded,
  type HealthStatus,
  healthy,
  type PrivacyDecision,
  type PrivacyFinding,
  type ServiceContext,
  type ServiceMeta,
} from '@aah/contracts';
import type { DisplayCaptureAdapter } from '@aah/display-capture';
import type { TtsAdapter } from '@aah/tts';
import { FakeShareAnalyzer, type ShareAnalyzer } from './analyzer.js';
import { decisionFor, PrivacyGuard } from './detectors.js';

export interface PrivacyGuardDeps {
  capture: DisplayCaptureAdapter;
  tts: TtsAdapter;
  /** Vision backend; defaults to a canned analyzer (finds nothing) when none is injected. */
  analyzer?: ShareAnalyzer;
  /** Risk engine; defaults to the standard detector set. */
  guard?: PrivacyGuard;
  /** Display source id to capture; defaults to the first available source. */
  sourceId?: string;
}

export class PrivacyGuardService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'privacy-guard',
    name: 'Privacy Guard',
    version: '0.1.0',
  };

  // Passive screen reads + spoken alerts only — both shared, so nothing is contended.
  readonly requires: Capability[] = [cap('displayOverlay', 'shared'), cap('audioOut', 'shared')];

  readonly #capture: DisplayCaptureAdapter;
  readonly #tts: TtsAdapter;
  readonly #analyzer: ShareAnalyzer;
  readonly #guard: PrivacyGuard;
  readonly #sourceId?: string;

  #ctx?: ServiceContext;
  #active = false;
  #busy = false;
  #detail = 'idle';
  #unsubscribe?: () => void;

  constructor(deps: PrivacyGuardDeps) {
    this.#capture = deps.capture;
    this.#tts = deps.tts;
    this.#analyzer = deps.analyzer ?? new FakeShareAnalyzer();
    this.#guard = deps.guard ?? new PrivacyGuard();
    this.#sourceId = deps.sourceId;
  }

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    // React to "check what I'm about to share" requests from the shell UI / share hook.
    this.#unsubscribe = ctx.bus.on('privacy/scan-requested', (payload) => {
      void this.scanNow(payload.sourceId);
    });
  }

  async onEnable(): Promise<void> {
    await this.#capture.open();
    this.#tts.open();
    this.#active = true;
    this.#detail = 'ready';
  }

  async onDisable(): Promise<void> {
    this.#active = false;
    // Release every lease here: audioOut (tts) and the display-capture handle.
    this.#tts.close();
    await this.#capture.close();
    const ctx = this.#ctx;
    if (ctx) ctx.bus.emit('overlay/detach', { id: this.#layerId, ownerId: ctx.selfId });
    this.#detail = 'idle';
  }

  async onUnload(): Promise<void> {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#ctx = undefined;
  }

  healthCheck(): HealthStatus {
    if (!this.#ctx) return degraded('not loaded');
    return healthy(this.#detail);
  }

  /**
   * Capture a frame, analyze it, assess privacy risks, then surface them (overlay +
   * speech) and publish a verdict. Does nothing unless enabled; re-entrant calls while
   * a scan is in flight are dropped so a key-mash can't queue a backlog of captures.
   */
  async scanNow(sourceId?: string): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx || !this.#active || this.#busy) return;
    this.#busy = true;
    try {
      const target = sourceId ?? this.#sourceId ?? (await this.#firstSource());
      if (!target) {
        this.#speak('No screen is available to scan.', true);
        this.#detail = 'no source';
        return;
      }
      const frame = await this.#capture.captureFrame(target);
      if (!frame) {
        this.#speak('Could not capture the screen to scan it.', true);
        this.#detail = 'capture failed';
        return;
      }
      const scene = await this.#analyzer.analyze(frame);
      const findings = scene ? this.#guard.assess(scene) : [];
      const decision = decisionFor(findings);
      this.#announce(ctx, target, decision, findings);
      this.#detail = `scanned: ${decision} (${findings.length})`;
    } catch (err) {
      this.#speak('Sorry, the screen could not be scanned for privacy risks.', true);
      this.#detail = `error: ${(err as Error).message}`;
    } finally {
      this.#busy = false;
    }
  }

  async #firstSource(): Promise<string | undefined> {
    const sources = await this.#capture.listSources();
    return sources[0]?.id;
  }

  /**
   * Blind-first surfacing: paint the findings panel on the overlay, speak an alerting
   * summary, and publish the verdict so the shell can hold the share for a decision.
   */
  #announce(
    ctx: ServiceContext,
    sourceId: string,
    decision: PrivacyDecision,
    findings: PrivacyFinding[],
  ): void {
    ctx.bus.emit('overlay/attach', {
      id: this.#layerId,
      ownerId: ctx.selfId,
      kind: 'privacy-warnings',
      params: { decision, findings },
    });
    // A risky result interrupts any in-flight speech so the warning isn't missed.
    this.#speak(summarize(decision, findings), decision !== 'allow');
    ctx.bus.emit('privacy/verdict', { sourceId, decision, findings });
  }

  /** Speak `text`; when `assertive`, flush any in-flight speech first so it leads. */
  #speak(text: string, assertive: boolean): void {
    if (assertive) this.#tts.cancel();
    void this.#tts.speak(text).catch(() => undefined);
  }

  get #layerId(): string {
    return `${this.meta.id}:warnings`;
  }
}

/** Build the spoken summary for a verdict — blind-first, leads with the call to action. */
export function summarize(decision: PrivacyDecision, findings: PrivacyFinding[]): string {
  if (decision === 'allow') return 'No private information detected. Safe to share.';
  const count = findings.length;
  const noun = count === 1 ? 'issue' : 'issues';
  const details = findings.map((f) => f.text).join(' ');
  const lead =
    decision === 'block'
      ? `Hold before sharing. ${count} ${noun} found.`
      : `Heads up before sharing. ${count} ${noun} found.`;
  return `${lead} ${details}`;
}
