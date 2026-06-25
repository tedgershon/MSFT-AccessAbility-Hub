/**
 * Display capture adapter.
 *
 * Thin adapter over platform/shell-specific display capture APIs (e.g. Electron
 * desktop capture in the shell process). Services should never import OS capture
 * APIs directly (Adapter pattern); they depend on this narrow surface and inject a
 * backend (a real shell-backed one in production, a fake one in tests).
 */

export interface DisplaySource {
  id: string;
  name: string;
  displayId?: string;
  thumbnailDataUrl?: string;
}

export interface DisplayFrame {
  sourceId: string;
  capturedAtMs: number;
  width: number;
  height: number;
  /** Opaque image payload (PNG/JPEG/RAW decided by backend). */
  data: Uint8Array;
}

export interface DisplayCaptureBackend {
  listSources(): Promise<DisplaySource[]>;
  captureFrame(sourceId: string): Promise<DisplayFrame | null>;
}

/**
 * Narrow shell-facing bindings so this package does not import Electron directly.
 * The shell adapter can implement this with desktopCapturer/nativeImage calls.
 */
export interface DesktopCaptureBindings {
  listSources(): Promise<DisplaySource[]>;
  captureFrame(
    sourceId: string,
  ): Promise<{ capturedAtMs: number; width: number; height: number; data: Uint8Array } | null>;
}

export class ElectronDisplayCaptureBackend implements DisplayCaptureBackend {
  constructor(private readonly bindings: DesktopCaptureBindings) {}

  async listSources(): Promise<DisplaySource[]> {
    return this.bindings.listSources();
  }

  async captureFrame(sourceId: string): Promise<DisplayFrame | null> {
    const captured = await this.bindings.captureFrame(sourceId);
    if (!captured) {
      return null;
    }
    return {
      sourceId,
      capturedAtMs: captured.capturedAtMs,
      width: captured.width,
      height: captured.height,
      data: captured.data,
    };
  }
}

export class FakeDisplayCaptureBackend implements DisplayCaptureBackend {
  #sources: DisplaySource[];
  #framesBySource = new Map<string, DisplayFrame[]>();

  constructor(sources: DisplaySource[] = []) {
    this.#sources = [...sources];
  }

  async listSources(): Promise<DisplaySource[]> {
    return [...this.#sources];
  }

  enqueueFrame(sourceId: string, frame: DisplayFrame): void {
    const queue = this.#framesBySource.get(sourceId) ?? [];
    queue.push(frame);
    this.#framesBySource.set(sourceId, queue);
  }

  async captureFrame(sourceId: string): Promise<DisplayFrame | null> {
    const queue = this.#framesBySource.get(sourceId) ?? [];
    return queue.shift() ?? null;
  }
}

/**
 * Wraps a {@link DisplayCaptureBackend}. Holding it open is a passive read of the
 * display; the adapter still gates capture behind `open()` so a service has one
 * clear acquire/release path that lines up with its lifecycle.
 */
export class DisplayCaptureAdapter {
  #open = false;

  constructor(private readonly backend: DisplayCaptureBackend) {}

  async open(): Promise<void> {
    this.#open = true;
  }

  async listSources(): Promise<DisplaySource[]> {
    return this.backend.listSources();
  }

  async captureFrame(sourceId: string): Promise<DisplayFrame | null> {
    if (!this.#open) {
      throw new Error('display capture is not open; call open() first');
    }
    return this.backend.captureFrame(sourceId);
  }

  async close(): Promise<void> {
    this.#open = false;
  }

  get isOpen(): boolean {
    return this.#open;
  }
}
