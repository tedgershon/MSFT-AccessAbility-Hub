/**
 * ArtInSight — screen image/artwork description for blind & low-vision users.
 *
 * On request (an `artinsight/describe-requested` event from the shell), it grabs a
 * screenshot via the injected display-capture adapter, turns it into a spoken
 * description with an injected vision describer, paints the text as an overlay
 * caption, and speaks it through the TTS adapter. Declares only shared resources
 * (displayOverlay + audioOut); both leases are released on disable.
 */

import {
  type AccessibilityService,
  cap,
  type Capability,
  degraded,
  type HealthStatus,
  healthy,
  type ServiceContext,
  type ServiceMeta,
} from '@aah/contracts';
import type { DisplayCaptureAdapter } from '@aah/display-capture';
import type { TtsAdapter } from '@aah/tts';
import { FakeSceneDescriber, type SceneDescriber } from './describer.js';

export interface ArtInSightDeps {
  capture: DisplayCaptureAdapter;
  tts: TtsAdapter;
  /** Vision backend; defaults to a canned describer when none is injected. */
  describer?: SceneDescriber;
  /** Display source id to capture; defaults to the first available source. */
  sourceId?: string;
}

export class ArtInSightService implements AccessibilityService {
  readonly meta: ServiceMeta = {
    id: 'artinsight',
    name: 'ArtInSight',
    version: '0.1.0',
  };

  // Passive screen reads + speech only — both shared, so nothing is contended.
  readonly requires: Capability[] = [cap('displayOverlay', 'shared'), cap('audioOut', 'shared')];

  readonly #capture: DisplayCaptureAdapter;
  readonly #tts: TtsAdapter;
  readonly #describer: SceneDescriber;
  readonly #sourceId?: string;

  #ctx?: ServiceContext;
  #active = false;
  #busy = false;
  #detail = 'idle';
  #unsubscribe?: () => void;

  constructor(deps: ArtInSightDeps) {
    this.#capture = deps.capture;
    this.#tts = deps.tts;
    this.#describer = deps.describer ?? new FakeSceneDescriber();
    this.#sourceId = deps.sourceId;
  }

  async onLoad(ctx: ServiceContext): Promise<void> {
    this.#ctx = ctx;
    // React to on-demand "describe what's on screen" requests from the shell UI.
    this.#unsubscribe = ctx.bus.on('artinsight/describe-requested', (payload) => {
      void this.describeNow(payload.sourceId);
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
   * Capture a frame, describe it, then caption + speak the result. Does nothing
   * unless enabled; re-entrant calls while a description is in flight are dropped so
   * a key-mash can't queue a backlog of captures.
   */
  async describeNow(sourceId?: string): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx || !this.#active || this.#busy) return;
    this.#busy = true;
    try {
      const target = sourceId ?? this.#sourceId ?? (await this.#firstSource());
      if (!target) {
        this.#announce(ctx, 'No screen is available to capture.');
        this.#detail = 'no source';
        return;
      }
      const frame = await this.#capture.captureFrame(target);
      if (!frame) {
        this.#announce(ctx, 'Could not capture the screen.');
        this.#detail = 'capture failed';
        return;
      }
      const description = await this.#describer.describe(frame);
      this.#announce(ctx, description);
      this.#detail = 'described';
    } catch (err) {
      this.#announce(ctx, 'Sorry, the screen could not be described.');
      this.#detail = `error: ${(err as Error).message}`;
    } finally {
      this.#busy = false;
    }
  }

  async #firstSource(): Promise<string | undefined> {
    const sources = await this.#capture.listSources();
    return sources[0]?.id;
  }

  /** Paint the text as an overlay caption and speak it. */
  #announce(ctx: ServiceContext, text: string): void {
    ctx.bus.emit('overlay/attach', {
      id: this.#layerId,
      ownerId: ctx.selfId,
      kind: 'caption',
      params: { text },
    });
    void this.#tts.speak(text).catch(() => undefined);
  }

  get #layerId(): string {
    return `${this.meta.id}:description`;
  }
}
