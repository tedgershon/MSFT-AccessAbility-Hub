import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventBus } from '@aah/contracts';
import { DisplayCaptureAdapter, FakeDisplayCaptureBackend } from '@aah/display-capture';
import { DisplayLuminancePublisher } from './display-luminance-publisher.js';

function createBusSpy(): { bus: EventBus; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  const bus: EventBus = {
    emit,
    on: vi.fn(() => () => {}),
    off: vi.fn(),
  };
  return { bus, emit };
}

describe('DisplayLuminancePublisher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes relative luminance from captured frames while running', async () => {
    vi.useFakeTimers();

    const backend = new FakeDisplayCaptureBackend([{ id: 'screen-1', name: 'Display 1' }]);
    // A single white RGBA pixel -> relative luminance 1.
    backend.enqueueFrame('screen-1', {
      sourceId: 'screen-1',
      capturedAtMs: 123,
      width: 1,
      height: 1,
      data: new Uint8Array([255, 255, 255, 255]),
    });

    const { bus, emit } = createBusSpy();
    const capture = new DisplayCaptureAdapter(backend);
    const publisher = new DisplayLuminancePublisher(bus, capture);

    await publisher.start('screen-1', 100);
    await vi.advanceTimersByTimeAsync(120);

    expect(publisher.running).toBe(true);
    expect(emit).toHaveBeenCalledWith('display/luminance', {
      sourceId: 'screen-1',
      luminance: expect.closeTo(1, 5) as unknown as number,
      atMs: 123,
    });

    await publisher.stop();
    expect(publisher.running).toBe(false);

    vi.useRealTimers();
  });

  it('does not emit when the backend yields no frame', async () => {
    vi.useFakeTimers();

    const backend = new FakeDisplayCaptureBackend([{ id: 'screen-1', name: 'Display 1' }]);
    const { bus, emit } = createBusSpy();
    const publisher = new DisplayLuminancePublisher(bus, new DisplayCaptureAdapter(backend));

    await publisher.start('screen-1', 100);
    await vi.advanceTimersByTimeAsync(120);

    expect(emit).not.toHaveBeenCalled();

    await publisher.stop();
    vi.useRealTimers();
  });
});
