"""Tests for the aah-ipc child-side runtime (headless, asyncio.run style)."""

from __future__ import annotations

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
    create_channel_pair,
    decode_frame,
    encode_frame,
)


def test_channel_pair_delivers_frames() -> None:
    host, child = create_channel_pair()
    received: list[Frame] = []
    child.on_message(received.append)

    host.send(LifecycleFrame(phase="enable"))

    assert received == [LifecycleFrame(phase="enable")]


def test_channel_unsubscribe_stops_delivery() -> None:
    host, child = create_channel_pair()
    received: list[Frame] = []
    unsub = child.on_message(received.append)

    unsub()
    host.send(LifecycleFrame(phase="load"))

    assert received == []


def test_frame_encode_decode_round_trip() -> None:
    frames: list[Frame] = [
        EventFrame(topic="input/intent", payload={"source": "py", "kind": "keyboard"}),
        LifecycleFrame(phase="disable"),
        HealthFrame(status=healthy("ok")),
    ]
    for frame in frames:
        line = encode_frame(frame)
        assert "\n" not in line
        assert decode_frame(line) == frame


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
        self._bus.emit(
            "input/intent",
            {"source": "py-fake", "kind": "keyboard", "payload": {"command": "go"}},
        )

    async def on_disable(self) -> None:
        self.calls.append("on_disable")

    async def on_unload(self) -> None:
        self.calls.append("on_unload")

    def health_check(self) -> HealthStatus:
        return healthy("py up")


def test_lifecycle_enable_invokes_hook_and_emits_event_and_health() -> None:
    host, child = create_channel_pair()
    out: list[Frame] = []
    host.on_message(out.append)

    service = _FakeService()
    ServiceHost(service, child)

    # load gives the service its ctx (and thus the bus client), then enable runs.
    host.send(LifecycleFrame(phase="load"))
    host.send(LifecycleFrame(phase="enable"))

    assert service.calls == ["on_load", "on_enable"]

    # on_enable emitted an event, then the host sent a health frame.
    assert len(out) == 2
    assert out[0] == EventFrame(
        topic="input/intent",
        payload={"source": "py-fake", "kind": "keyboard", "payload": {"command": "go"}},
    )
    health = out[1]
    assert isinstance(health, HealthFrame)
    assert health.status.state == "healthy"
    assert health.status.detail == "py up"


def test_health_frame_reflects_health_check() -> None:
    host, child = create_channel_pair()
    out: list[Frame] = []
    host.on_message(out.append)

    service = _FakeService()
    service_host = ServiceHost(service, child)

    service_host.send_health()

    assert len(out) == 1
    frame = out[0]
    assert isinstance(frame, HealthFrame)
    assert frame.status.state == "healthy"
    assert frame.status.detail == "py up"


def test_disable_invokes_hook_and_reports_health() -> None:
    host, child = create_channel_pair()
    out: list[Frame] = []
    host.on_message(out.append)

    service = _FakeService()
    ServiceHost(service, child)

    host.send(LifecycleFrame(phase="load"))
    host.send(LifecycleFrame(phase="disable"))

    assert service.calls == ["on_load", "on_disable"]
    assert len(out) == 1
    health = out[0]
    assert isinstance(health, HealthFrame)
    assert health.status.state == "healthy"
    assert health.status.detail == "py up"
