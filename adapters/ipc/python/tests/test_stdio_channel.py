"""Tests for the aah-ipc StdioChannel (real NDJSON transport over binary streams).

Uses in-memory ``io.BytesIO`` streams so the blocking ``serve()`` loop terminates at
EOF — no real stdin/stdout and no subprocess are involved.
"""

from __future__ import annotations

import io
import json
from typing import Any

from aah_contracts import (
    AccessibilityService,
    HealthStatus,
    ServiceContext,
    ServiceMeta,
    healthy,
)
from aah_ipc import (
    EventFrame,
    Frame,
    HealthFrame,
    LifecycleFrame,
    ServiceHost,
    StdioChannel,
    decode_frame,
    encode_frame,
)


def _ndjson(*frames: Frame) -> bytes:
    return b"".join(encode_frame(f).encode("utf-8") + b"\n" for f in frames)


def test_serve_dispatches_each_decoded_frame() -> None:
    inp = io.BytesIO(
        _ndjson(
            LifecycleFrame(phase="load"),
            LifecycleFrame(phase="enable"),
            EventFrame(topic="input/intent", payload={"command": "go"}),
        )
    )
    out = io.BytesIO()
    channel = StdioChannel(inp, out)

    received: list[Frame] = []
    channel.on_message(received.append)

    channel.serve()  # returns at EOF

    assert received == [
        LifecycleFrame(phase="load"),
        LifecycleFrame(phase="enable"),
        EventFrame(topic="input/intent", payload={"command": "go"}),
    ]


def test_serve_ignores_blank_lines() -> None:
    payload = b"\n\n" + encode_frame(LifecycleFrame(phase="enable")).encode("utf-8") + b"\n\n"
    channel = StdioChannel(io.BytesIO(payload), io.BytesIO())
    received: list[Frame] = []
    channel.on_message(received.append)

    channel.serve()

    assert received == [LifecycleFrame(phase="enable")]


def test_send_writes_newline_terminated_json_line() -> None:
    out = io.BytesIO()
    channel = StdioChannel(io.BytesIO(b""), out)

    channel.send(LifecycleFrame(phase="load"))

    data = out.getvalue()
    assert data.endswith(b"\n")
    text = data.decode("utf-8").rstrip("\n")
    assert "\n" not in text
    assert json.loads(text) == {"kind": "lifecycle", "phase": "load"}
    assert decode_frame(text) == LifecycleFrame(phase="load")


def test_malformed_line_is_skipped_without_raising() -> None:
    valid = encode_frame(LifecycleFrame(phase="enable")).encode("utf-8")
    payload = b"not json{{{\n" + valid + b"\n"
    errors: list[str] = []
    channel = StdioChannel(
        io.BytesIO(payload),
        io.BytesIO(),
        on_error=lambda _exc, line: errors.append(line),
    )
    received: list[Frame] = []
    channel.on_message(received.append)

    channel.serve()  # must not raise

    assert errors == ["not json{{{"]
    assert received == [LifecycleFrame(phase="enable")]


class _FakeService(AccessibilityService):
    """Records lifecycle calls; emits a bus event during on_enable."""

    def __init__(self) -> None:
        self.meta = ServiceMeta(id="py-fake", name="Py Fake", version="0.0.0")
        self.requires = []
        self.calls: list[str] = []
        self._bus: Any = None

    async def on_load(self, ctx: ServiceContext) -> None:
        self._bus = ctx.bus
        self.calls.append("on_load")

    async def on_enable(self) -> None:
        self.calls.append("on_enable")
        self._bus.emit("input/intent", {"source": "py-fake", "kind": "keyboard"})

    async def on_disable(self) -> None:
        self.calls.append("on_disable")

    async def on_unload(self) -> None:
        self.calls.append("on_unload")

    def health_check(self) -> HealthStatus:
        return healthy("py up")


def test_service_host_over_stdio_channel_happy_path() -> None:
    inp = io.BytesIO(_ndjson(LifecycleFrame(phase="load"), LifecycleFrame(phase="enable")))
    out = io.BytesIO()
    channel = StdioChannel(inp, out)

    service = _FakeService()
    ServiceHost(service, channel)

    channel.serve()

    assert service.calls == ["on_load", "on_enable"]

    # Parse the frames the host wrote back: an event (from on_enable) then health.
    lines = [line for line in out.getvalue().decode("utf-8").split("\n") if line]
    out_frames = [decode_frame(line) for line in lines]
    assert out_frames[0] == EventFrame(
        topic="input/intent", payload={"source": "py-fake", "kind": "keyboard"}
    )
    assert isinstance(out_frames[1], HealthFrame)
    assert out_frames[1].status.state == "healthy"
    assert out_frames[1].status.detail == "py up"
