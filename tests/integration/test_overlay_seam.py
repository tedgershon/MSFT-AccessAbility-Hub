"""Cross-seam integration: Python overlay emission -> TS-consumable wire bytes.

This is the *producer* half of the TS<->Python overlay bridge. A Python service emits
the shared :class:`OverlayLayer` contract; the IPC seam must serialize it to the exact
camelCase NDJSON line the TS host reads (issue #57). The matching *consumer* half lives
in ``overlay-seam.test.ts``, which feeds the same canonical line through the real TS
``StdioChannel`` -> ``BusBridge`` and asserts the layer arrives with ``ownerId``.

Run by pytest (the TS half is run by vitest), so each runtime exercises its own side of
the seam against a shared, byte-for-byte wire contract.
"""

from __future__ import annotations

import io
import json

from aah_contracts import (
    OVERLAY_ATTACH,
    OVERLAY_DETACH,
    OverlayLayer,
)
from aah_ipc import EventFrame, StdioChannel, encode_frame

# The canonical wire line a Python service produces for an empty coach overlay. The TS
# consumer test pins this exact string — keep the two in lockstep.
CANONICAL_ATTACH_LINE = (
    '{"kind":"event","topic":"overlay/attach","payload":'
    '{"id":"conversation-coach:prompts","ownerId":"conversation-coach",'
    '"kind":"coach-prompts","params":{"prompts":[]}}}'
)


def _attach_layer() -> OverlayLayer:
    return OverlayLayer(
        id="conversation-coach:prompts",
        owner_id="conversation-coach",
        kind="coach-prompts",
        params={"prompts": []},
    )


def test_overlay_layer_serializes_to_camelcase_wire() -> None:
    # Emitting the snake_case contract dataclass must yield the camelCase TS wire shape.
    line = encode_frame(EventFrame(topic=OVERLAY_ATTACH, payload=_attach_layer()))
    assert line == CANONICAL_ATTACH_LINE

    payload = json.loads(line)["payload"]
    assert payload["ownerId"] == "conversation-coach"
    assert "owner_id" not in payload


def test_overlay_emission_over_real_stdio_channel() -> None:
    # Drive a real StdioChannel (the production transport) and inspect the bytes that
    # would cross to the TS host: one NDJSON frame, camelCase, newline-terminated.
    output = io.BytesIO()
    channel = StdioChannel(input=io.BytesIO(), output=output)
    channel.send(EventFrame(topic=OVERLAY_ATTACH, payload=_attach_layer()))

    raw = output.getvalue()
    assert raw.endswith(b"\n")
    payload = json.loads(raw.decode("utf-8"))["payload"]
    assert payload == {
        "id": "conversation-coach:prompts",
        "ownerId": "conversation-coach",
        "kind": "coach-prompts",
        "params": {"prompts": []},
    }


def test_overlay_detach_mapping_casts_owner_id() -> None:
    # The detach payload is the contract ``{id, owner_id}``; the seam casts it too.
    line = encode_frame(
        EventFrame(
            topic=OVERLAY_DETACH,
            payload={"id": "conversation-coach:prompts", "owner_id": "conversation-coach"},
        )
    )
    payload = json.loads(line)["payload"]
    assert payload == {"id": "conversation-coach:prompts", "ownerId": "conversation-coach"}
