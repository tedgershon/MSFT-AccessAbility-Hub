/**
 * Cross-seam integration: TS consumes a Python-emitted overlay across the bridge.
 *
 * This is the *consumer* half of the TS<->Python overlay seam (issue #57). A Python
 * service emits the shared `OverlayLayer` contract; the Python IPC seam serializes it
 * to a camelCase NDJSON line (pinned by the producer test,
 * `tests/integration/test_overlay_seam.py`). Here we feed that exact line through the
 * real TS `StdioChannel` -> `BusBridge` and assert it surfaces on the TS event bus as
 * a well-formed `OverlayLayer` with `ownerId` — proving the seam round-trips the
 * snake_case->camelCase conversion end to end.
 */

import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { OverlayLayer } from '@aah/contracts';
import { BusBridge, StdioChannel } from '@aah/ipc';
import { InMemoryEventBus } from '@aah/kernel';

/**
 * The exact NDJSON line a Python service produces for an empty coach overlay. Kept
 * byte-for-byte in lockstep with `CANONICAL_ATTACH_LINE` in the Python producer test,
 * so both ends of the seam meet on identical wire bytes.
 */
const CANONICAL_ATTACH_LINE =
  '{"kind":"event","topic":"overlay/attach","payload":' +
  '{"id":"conversation-coach:prompts","ownerId":"conversation-coach",' +
  '"kind":"coach-prompts","params":{"prompts":[]}}}';

describe('overlay seam (TS consumer of Python emission)', () => {
  it('delivers a Python-emitted OverlayLayer to a TS subscriber with camelCase ownerId', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const channel = new StdioChannel(input, output);
    const bus = new InMemoryEventBus();
    const bridge = new BusBridge(bus, channel, { forward: [] });
    bridge.mount();

    const received = new Promise<OverlayLayer>((resolve) => {
      bus.on('overlay/attach', (layer) => resolve(layer));
    });

    // The raw bytes Python wrote to its stdout arrive on the channel's input.
    input.write(CANONICAL_ATTACH_LINE + '\n');

    const layer = await received;
    expect(layer).toEqual({
      id: 'conversation-coach:prompts',
      ownerId: 'conversation-coach',
      kind: 'coach-prompts',
      params: { prompts: [] },
    });
    // The owner survives the seam under the TS-facing camelCase key, not snake_case.
    expect(layer.ownerId).toBe('conversation-coach');
    expect((layer as Record<string, unknown>).owner_id).toBeUndefined();

    bridge.dispose();
    channel.close();
  });
});
