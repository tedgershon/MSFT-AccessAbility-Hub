"""aah-ipc — Python (child) side of the transport-agnostic IPC seam.

Mirror of the TS ``@aah/ipc`` adapter. A Python service never calls the kernel
directly (hard rule #4): it publishes onto the hub bus by sending ``event`` frames
across a :class:`Channel`, and receives lifecycle commands as ``lifecycle`` frames.
:class:`ServiceHost` is the child-side runtime that drives a service's async hooks
and reports health back to the host.

This slice is headless: :func:`create_channel_pair` models the boundary in-memory and
a real stdio/socket transport plugs in later behind the same ``Channel`` protocol.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol, runtime_checkable

from aah_contracts import (
    AccessibilityService,
    HealthStatus,
    ServiceContext,
)

LifecyclePhase = Literal["load", "enable", "disable", "unload"]


# ---------------------------------------------------------------------------
# Frame envelope (mirror of frame.ts)
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class EventFrame:
    """A bus event relayed across the seam."""

    topic: str
    payload: Any
    kind: Literal["event"] = "event"


@dataclass(frozen=True, slots=True)
class LifecycleFrame:
    """A host -> child lifecycle command."""

    phase: LifecyclePhase
    kind: Literal["lifecycle"] = "lifecycle"


@dataclass(frozen=True, slots=True)
class HealthFrame:
    """A child -> host health report."""

    status: HealthStatus
    kind: Literal["health"] = "health"


Frame = EventFrame | LifecycleFrame | HealthFrame


def _health_to_wire(status: HealthStatus) -> dict[str, Any]:
    # camelCase ``checkedAt`` to match the TS wire shape for a future real transport.
    return {"state": status.state, "detail": status.detail, "checkedAt": status.checked_at}


def _health_from_wire(data: dict[str, Any]) -> HealthStatus:
    return HealthStatus(
        state=data["state"],
        detail=data.get("detail"),
        checked_at=data["checkedAt"],
    )


def encode_frame(frame: Frame) -> str:
    """Serialize a frame to a single newline-free JSON line for a real transport."""
    if isinstance(frame, EventFrame):
        obj: dict[str, Any] = {"kind": "event", "topic": frame.topic, "payload": frame.payload}
    elif isinstance(frame, LifecycleFrame):
        obj = {"kind": "lifecycle", "phase": frame.phase}
    else:
        obj = {"kind": "health", "status": _health_to_wire(frame.status)}
    return json.dumps(obj, separators=(",", ":"))


def decode_frame(line: str) -> Frame:
    """Parse a single JSON line back into a :data:`Frame`."""
    obj = json.loads(line)
    kind = obj["kind"]
    if kind == "event":
        return EventFrame(topic=obj["topic"], payload=obj["payload"])
    if kind == "lifecycle":
        return LifecycleFrame(phase=obj["phase"])
    if kind == "health":
        return HealthFrame(status=_health_from_wire(obj["status"]))
    raise ValueError(f"unknown frame kind: {kind!r}")


# ---------------------------------------------------------------------------
# Channel transport abstraction (mirror of channel.ts)
# ---------------------------------------------------------------------------
FrameHandler = Callable[[Frame], None]


@runtime_checkable
class Channel(Protocol):
    """One end of a bidirectional, frame-oriented pipe."""

    def send(self, frame: Frame) -> None: ...

    def on_message(self, handler: FrameHandler) -> Callable[[], None]: ...

    def close(self) -> None: ...


class _InMemoryChannel:
    """One end of an in-memory pair; delivers synchronously to the peer's handlers."""

    def __init__(self) -> None:
        self._handlers: set[FrameHandler] = set()
        self._peer: _InMemoryChannel | None = None
        self._closed = False

    def _link(self, peer: _InMemoryChannel) -> None:
        self._peer = peer

    def send(self, frame: Frame) -> None:
        if self._closed:
            return
        peer = self._peer
        if peer is None or peer._closed:
            return
        for handler in list(peer._handlers):
            handler(frame)

    def on_message(self, handler: FrameHandler) -> Callable[[], None]:
        self._handlers.add(handler)

        def unsubscribe() -> None:
            self._handlers.discard(handler)

        return unsubscribe

    def close(self) -> None:
        self._closed = True
        self._handlers.clear()


def create_channel_pair() -> tuple[Channel, Channel]:
    """Two linked in-memory channels: ``(host, child)``. For tests; no real IO."""
    host = _InMemoryChannel()
    child = _InMemoryChannel()
    host._link(child)
    child._link(host)
    return host, child


# ---------------------------------------------------------------------------
# ServiceHost — child-side runtime
# ---------------------------------------------------------------------------
class _ChannelBus:
    """Bus-like client injected into the child service's ``ServiceContext``.

    ``emit(topic, payload)`` ships an ``event`` frame across the seam, which the host
    re-emits onto the real kernel bus. Inbound delivery to the child is not part of
    this slice, so ``on``/``off`` are inert.
    """

    def __init__(self, channel: Channel) -> None:
        self._channel = channel

    def emit(self, topic: str, payload: Any) -> None:
        self._channel.send(EventFrame(topic=topic, payload=payload))

    def on(self, _topic: str, _handler: Callable[[Any], None]) -> Callable[[], None]:
        return lambda: None

    def off(self, _topic: str, _handler: Callable[[Any], None]) -> None:
        return None


class ServiceHost:
    """Drives a Python :class:`AccessibilityService` across the IPC seam.

    Listens for ``lifecycle`` frames and invokes the matching async hook (via
    ``asyncio.run`` per message — no running loop is assumed, matching the existing
    sync-style tests). Injects a :class:`_ChannelBus` so the service can publish bus
    events outbound. Emits a ``health`` frame after enable/disable and on demand.
    """

    def __init__(
        self,
        service: AccessibilityService,
        channel: Channel,
        *,
        config: dict[str, Any] | None = None,
    ) -> None:
        self._service = service
        self._channel = channel
        self._bus = _ChannelBus(channel)
        self._config: dict[str, Any] = config if config is not None else {}
        self._unsubscribe = channel.on_message(self._on_frame)

    def _on_frame(self, frame: Frame) -> None:
        if isinstance(frame, LifecycleFrame):
            asyncio.run(self._handle_lifecycle(frame.phase))

    async def _handle_lifecycle(self, phase: LifecyclePhase) -> None:
        if phase == "load":
            ctx = ServiceContext(
                self_id=self._service.meta.id,
                bus=self._bus,
                config=self._config,
            )
            await self._service.on_load(ctx)
        elif phase == "enable":
            await self._service.on_enable()
            self.send_health()
        elif phase == "disable":
            await self._service.on_disable()
            self.send_health()
        elif phase == "unload":
            await self._service.on_unload()

    def send_health(self) -> None:
        """Emit a ``health`` frame reflecting the service's current health."""
        self._channel.send(HealthFrame(status=self._service.health_check()))

    def close(self) -> None:
        """Stop listening for frames from the channel."""
        self._unsubscribe()


__all__ = [
    "LifecyclePhase",
    "EventFrame",
    "LifecycleFrame",
    "HealthFrame",
    "Frame",
    "encode_frame",
    "decode_frame",
    "Channel",
    "create_channel_pair",
    "ServiceHost",
]
