import { describe, expect, it } from 'vitest';
import {
  DisplayCaptureAdapter,
  ElectronDisplayCaptureBackend,
  FakeDisplayCaptureBackend,
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
      async captureFrame(sourceId) {
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
    expect(await backend.listSources()).toEqual([
      { id: 'screen-2', name: 'Display 2', displayId: '2' },
    ]);
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
