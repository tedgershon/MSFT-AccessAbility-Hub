import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventBus } from '@aah/contracts';
import { DisplayCaptureAdapter, FakeDisplayCaptureBackend } from '@aah/display-capture';
import { DisplayFramePublisher } from './display-frame-publisher.js';

function createBusSpy(): { bus: EventBus; emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  const bus: EventBus = {
    emit,
    on: vi.fn(() => () => {}),
    off: vi.fn(),
  };
  return { bus, emit };
}

describe('DisplayFramePublisher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes display frame references while running', async () => {
    vi.useFakeTimers();

    const backend = new FakeDisplayCaptureBackend([{ id: 'screen-1', name: 'Display 1' }]);
    backend.enqueueFrame('screen-1', {
      sourceId: 'screen-1',
      capturedAtMs: 123,
      width: 1920,
      height: 1080,
      data: new Uint8Array([1]),
    });

    const { bus, emit } = createBusSpy();
    const capture = new DisplayCaptureAdapter(backend);
    const publisher = new DisplayFramePublisher(bus, capture, 'publisher-test');

    await publisher.start('screen-1', 100);
    await vi.advanceTimersByTimeAsync(120);

    expect(publisher.running).toBe(true);
    expect(emit).toHaveBeenCalledWith('display/frame-ref', {
      sourceServiceId: 'publisher-test',
      capturedAtMs: 123,
      width: 1920,
      height: 1080,
    });

    await publisher.stop();
    expect(publisher.running).toBe(false);

    vi.useRealTimers();
  });
});
