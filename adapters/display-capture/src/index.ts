/**
 * Display capture adapter.
 *
 * Thin adapter over platform/shell-specific display capture APIs (e.g. Electron
 * desktop capture in the shell process). Services should never import OS capture
 * APIs directly.
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

/**
 * Rec. 709 relative luminance (0..1) of one sRGB pixel from 8-bit channels.
 * `L = 0.2126 R + 0.7152 G + 0.0722 B`, normalized by 255.
 */
export function pixelRelativeLuminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Average relative luminance (0..1) over a frame's raw RGBA8 pixel buffer
 * (4 bytes/pixel: R, G, B, A; alpha ignored). Returns 0 for an empty buffer.
 *
 * Callers must pass raw pixels (e.g. Electron `nativeImage.toBitmap()`), not an
 * encoded PNG/JPEG. Buffers captured as BGRA track luminance over time correctly;
 * only the per-channel weighting differs slightly, which flash detection tolerates.
 */
export function frameRelativeLuminance(frame: DisplayFrame): number {
  const data = frame.data;
  const pixels = Math.floor(data.length / 4);
  if (pixels === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    sum += pixelRelativeLuminance(data[o], data[o + 1], data[o + 2]);
  }
  return sum / pixels;
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
  captureFrame(sourceId: string): Promise<{
    capturedAtMs: number;
    width: number;
    height: number;
    data: Uint8Array;
  } | null>;
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
  readonly #sources: DisplaySource[];
  readonly #framesBySource = new Map<string, DisplayFrame[]>();

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
