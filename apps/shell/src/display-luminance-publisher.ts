/**
 * Shell-side display luminance publisher.
 *
 * The display-capture adapter only yields raw frames; this thin shell binding
 * samples on an interval, computes each frame's relative luminance, and emits a
 * typed `display/luminance` event onto the bus. Photosensitive guards (e.g.
 * `flash-filter`) consume it over the bus instead of being called directly, keeping
 * the screen-capture seam on the event bus.
 */

import type { EventBus } from '@aah/contracts';
import { type DisplayCaptureAdapter, frameRelativeLuminance } from '@aah/display-capture';

export class DisplayLuminancePublisher {
  #timer?: ReturnType<typeof setInterval>;
  #capturing = false;

  constructor(
    private readonly bus: EventBus,
    private readonly capture: DisplayCaptureAdapter,
  ) {}

  /** Open the capture adapter and begin sampling `sourceId` every `intervalMs`. */
  async start(sourceId: string, intervalMs = 250): Promise<void> {
    if (this.#timer) return;
    await this.capture.open();
    this.#timer = setInterval(() => {
      void this.#sampleOnce(sourceId);
    }, intervalMs);
  }

  /** Stop sampling and release the capture adapter. */
  async stop(): Promise<void> {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    await this.capture.close();
  }

  get running(): boolean {
    return this.#timer !== undefined;
  }

  async #sampleOnce(sourceId: string): Promise<void> {
    // Skip if a previous capture is still in flight (avoid overlapping samples).
    if (this.#capturing) return;
    this.#capturing = true;
    try {
      const frame = await this.capture.captureFrame(sourceId);
      if (!frame) return;
      this.bus.emit('display/luminance', {
        sourceId,
        luminance: frameRelativeLuminance(frame),
        atMs: frame.capturedAtMs,
      });
    } finally {
      this.#capturing = false;
    }
  }
}
