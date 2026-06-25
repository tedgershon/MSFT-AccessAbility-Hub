import type { EventBus } from '@aah/contracts';
import type { DisplayCaptureAdapter } from '@aah/display-capture';

/**
 * Shell-side display frame metadata publisher.
 *
 * The adapter only captures raw frames; this publisher decides when to sample and
 * emits typed display/frame-ref events onto the bus.
 */
export class DisplayFramePublisher {
  #timer: ReturnType<typeof setInterval> | undefined;
  #capturing = false;

  constructor(
    private readonly bus: EventBus,
    private readonly capture: DisplayCaptureAdapter,
    private readonly sourceServiceId = 'shell-display-capture',
  ) {}

  async start(sourceId: string, intervalMs = 250): Promise<void> {
    if (this.#timer) return;
    await this.capture.open();
    this.#timer = setInterval(() => {
      void this.#captureOnce(sourceId);
    }, intervalMs);
  }

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

  async #captureOnce(sourceId: string): Promise<void> {
    if (this.#capturing) return;
    this.#capturing = true;
    try {
      const frame = await this.capture.captureFrame(sourceId);
      if (!frame) return;
      this.bus.emit('display/frame-ref', {
        sourceServiceId: this.sourceServiceId,
        capturedAtMs: frame.capturedAtMs,
        width: frame.width,
        height: frame.height,
      });
    } finally {
      this.#capturing = false;
    }
  }
}
