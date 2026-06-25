"""Unit tests for the stdio host runtime."""

from __future__ import annotations

import io
import json

from aah_contracts import AccessibilityService, HealthStatus, ServiceContext, ServiceMeta, healthy
from aah_host import HostBus, run_stdio_host


def test_host_bus_subscribe_emit_and_dispose() -> None:
    bus = HostBus()
    received: list[object] = []
    dispose = bus.on("display/frame-ref", received.append)

    bus.emit("display/frame-ref", {"width": 1})
    dispose()
    bus.emit("display/frame-ref", {"width": 2})

    assert received == [{"width": 1}]


class _EchoService(AccessibilityService):
    """On an inbound frame ref, emit a derived gaze point. Tracks teardown."""

    meta = ServiceMeta(id="echo", name="Echo", version="0.0.0")
    requires = []

    def __init__(self, lifecycle: list[str]) -> None:
        self._ctx: ServiceContext | None = None
        self._lifecycle = lifecycle

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx
        ctx.bus.on("display/frame-ref", self._on_frame)
        self._lifecycle.append("load")

    async def on_enable(self) -> None:
        self._lifecycle.append("enable")

    async def on_disable(self) -> None:
        self._lifecycle.append("disable")

    async def on_unload(self) -> None:
        self._lifecycle.append("unload")

    def health_check(self) -> HealthStatus:
        return healthy()

    def _on_frame(self, payload: dict) -> None:
        assert self._ctx is not None
        self._ctx.bus.emit("gaze/point", {"echoed": payload})


def test_inbound_stdin_drives_service_and_writes_outbound() -> None:
    lifecycle: list[str] = []
    stdin = io.StringIO(
        json.dumps({"topic": "display/frame-ref", "payload": {"width": 1920}}) + "\n"
    )
    stdout = io.StringIO()

    run_stdio_host(
        [_EchoService(lifecycle)],
        inbound=["display/frame-ref"],
        outbound=["gaze/point"],
        stdin=stdin,
        stdout=stdout,
    )

    frames = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert {"topic": "gaze/point", "payload": {"echoed": {"width": 1920}}} in frames
    # EOF tears the service down in lifecycle order, releasing leases (rule 5).
    assert lifecycle == ["load", "enable", "disable", "unload"]


def test_inbound_topic_outside_allowlist_is_ignored() -> None:
    lifecycle: list[str] = []
    stdin = io.StringIO(
        json.dumps({"topic": "service/health", "payload": {"x": 1}}) + "\n"
    )
    stdout = io.StringIO()

    run_stdio_host(
        [_EchoService(lifecycle)],
        inbound=["display/frame-ref"],
        outbound=["gaze/point"],
        stdin=stdin,
        stdout=stdout,
    )

    assert stdout.getvalue() == ""


def test_malformed_line_is_skipped() -> None:
    stdin = io.StringIO("not json\n" + json.dumps({"topic": "x", "payload": 1}) + "\n")
    stdout = io.StringIO()

    # Should not raise; the bad line is dropped and the host still tears down cleanly.
    run_stdio_host([], inbound=["x"], outbound=[], stdin=stdin, stdout=stdout)

    assert stdout.getvalue() == ""
