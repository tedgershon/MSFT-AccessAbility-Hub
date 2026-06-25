import { describe, expect, it } from 'vitest';
import {
  DisplayCaptureAdapter,
  ElectronDisplayCaptureBackend,
  FakeDisplayCaptureBackend,
  frameRelativeLuminance,
  pixelRelativeLuminance,
  type DesktopCaptureBindings,
  type DisplayFrame,
} from './index.js';

describe('DisplayCaptureAdapter', () => {
  it('requires open before capture', async () => {
    const backend = new FakeDisplayCaptureBackend([{ id: 'screen-1', name: 'Display 1' }]);
    const adapter = new DisplayCaptureAdapter(backend);

    await expect(adapter.captureFrame('screen-1')).rejects.toThrow(
      'display capture is not open; call open() first',
    );
  });

  it('lists sources and captures queued frames', async () => {
    const backend = new FakeDisplayCaptureBackend([{ id: 'screen-1', name: 'Display 1' }]);
    const frame: DisplayFrame = {
      sourceId: 'screen-1',
      capturedAtMs: 1,
      width: 1920,
      height: 1080,
      data: new Uint8Array([1, 2, 3]),
    };
    backend.enqueueFrame('screen-1', frame);

    const adapter = new DisplayCaptureAdapter(backend);
    await adapter.open();

    const sources = await adapter.listSources();
    expect(sources).toEqual([{ id: 'screen-1', name: 'Display 1' }]);

    const first = await adapter.captureFrame('screen-1');
    const second = await adapter.captureFrame('screen-1');

    expect(first).toEqual(frame);
    expect(second).toBeNull();

    await adapter.close();
    expect(adapter.isOpen).toBe(false);
  });
});

describe('ElectronDisplayCaptureBackend', () => {
  it('maps binding output into display frames', async () => {
    const bindings: DesktopCaptureBindings = {
      async listSources() {
        return [{ id: 'screen-2', name: 'Display 2', displayId: '2' }];
      },
      async captureFrame(sourceId: string) {
        if (sourceId !== 'screen-2') return null;
        return {
          capturedAtMs: 10,
          width: 2560,
          height: 1440,
          data: new Uint8Array([9, 8]),
        };
      },
    };

    const backend = new ElectronDisplayCaptureBackend(bindings);

    expect(await backend.listSources()).toEqual([{ id: 'screen-2', name: 'Display 2', displayId: '2' }]);
    expect(await backend.captureFrame('screen-2')).toEqual({
      sourceId: 'screen-2',
      capturedAtMs: 10,
      width: 2560,
      height: 1440,
      data: new Uint8Array([9, 8]),
    });
    expect(await backend.captureFrame('missing')).toBeNull();
  });
});

describe('pixelRelativeLuminance', () => {
  it('applies Rec. 709 weights (green > red > blue)', () => {
    expect(pixelRelativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 5);
    expect(pixelRelativeLuminance(0, 255, 0)).toBeCloseTo(0.7152, 5);
    expect(pixelRelativeLuminance(0, 0, 255)).toBeCloseTo(0.0722, 5);
  });
});

describe('frameRelativeLuminance', () => {
  const frame = (data: number[]): DisplayFrame => ({
    sourceId: 'screen-1',
    capturedAtMs: 0,
    width: 1,
    height: 1,
    data: new Uint8Array(data),
  });

  it('returns 0 for an empty buffer', () => {
    expect(frameRelativeLuminance(frame([]))).toBe(0);
  });

  it('maps white to 1 and black to 0', () => {
    expect(frameRelativeLuminance(frame([255, 255, 255, 255]))).toBeCloseTo(1, 5);
    expect(frameRelativeLuminance(frame([0, 0, 0, 255]))).toBe(0);
  });

  it('averages relative luminance across RGBA pixels, ignoring alpha', () => {
    // One pure-green pixel and one pure-blue pixel.
    const two = frame([0, 255, 0, 0, 0, 0, 255, 255]);
    expect(frameRelativeLuminance(two)).toBeCloseTo((0.7152 + 0.0722) / 2, 5);
  });
});
