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
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, BinaryIO, Literal, Protocol, runtime_checkable

from aah_contracts import (
    OVERLAY_ATTACH,
    OVERLAY_DETACH,
    OVERLAY_UPDATE,
    AccessibilityService,
    HealthStatus,
    OverlayLayer,
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


# Overlay event topics carry the shared ``OverlayLayer`` contract, whose Python
# dataclass is snake_case (``owner_id``) while the TS wire contract + host overlay
# surface expect camelCase (``ownerId``). Without this seam conversion, ``json.dumps``
# would ship ``owner_id`` and the TS surface would silently drop the layer's owner.
_OVERLAY_TOPICS = frozenset({OVERLAY_ATTACH, OVERLAY_UPDATE, OVERLAY_DETACH})


def _overlay_to_wire(payload: Any) -> Any:
    """Convert an overlay payload to the camelCase TS wire shape (``owner_id``->``ownerId``).

    Mirrors :func:`_health_to_wire`. Accepts the shared :class:`OverlayLayer` dataclass
    (``overlay/attach`` / ``overlay/update``) or a detach mapping ``{id, owner_id}``.
    Payloads already in camelCase pass through unchanged, so the conversion is
    idempotent and tolerant of older emitters.
    """
    if isinstance(payload, OverlayLayer):
        return {
            "id": payload.id,
            "ownerId": payload.owner_id,
            "kind": payload.kind,
            "params": payload.params,
        }
    if isinstance(payload, dict) and "owner_id" in payload:
        wire = dict(payload)
        wire["ownerId"] = wire.pop("owner_id")
        return wire
    return payload


def _health_from_wire(data: dict[str, Any]) -> HealthStatus:
    return HealthStatus(
        state=data["state"],
        detail=data.get("detail"),
        checked_at=data["checkedAt"],
    )


def encode_frame(frame: Frame) -> str:
    """Serialize a frame to a single newline-free JSON line for a real transport."""
    if isinstance(frame, EventFrame):
        payload = frame.payload
        if frame.topic in _OVERLAY_TOPICS:
            payload = _overlay_to_wire(payload)
        obj: dict[str, Any] = {"kind": "event", "topic": frame.topic, "payload": payload}
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
# Periodic scheduler — the shared "tick" pump owned by the host
# ---------------------------------------------------------------------------
@runtime_checkable
class TickingService(Protocol):
    """Optional service surface: opt into the host's periodic scheduler.

    A compute service that needs a steady loop (poll camera/mic, run inference, emit
    overlay updates) declares a positive ``tick_interval_s`` and implements ``tick``.
    The :class:`ServiceHost` then drives ``tick`` on a timer **while enabled** — the
    service never owns a thread. The host pauses the pump while disabled and stops/joins
    it on disable/unload. A service that doesn't implement this surface is simply never
    ticked.
    """

    tick_interval_s: float

    def tick(self) -> Any: ...


class _Scheduler:
    """Host-owned periodic driver: calls ``tick`` every ``interval_s`` on a daemon thread.

    Centralises the start/stop/join correctness that every compute service would
    otherwise re-solve. A tick that raises is routed to ``on_error`` (default: swallow)
    so one bad window can't kill the pump — the service's ``health_check`` surfaces a
    lost lease and the supervisor restarts it. :meth:`stop` is idempotent and safe to
    call from any thread except the tick thread itself (it skips the self-join).
    """

    def __init__(
        self,
        tick: Callable[[], Any],
        interval_s: float,
        *,
        on_error: Callable[[Exception], None] | None = None,
        join_timeout_s: float = 2.0,
    ) -> None:
        self._tick = tick
        self._interval_s = max(0.0, interval_s)
        self._on_error = on_error
        self._join_timeout_s = join_timeout_s
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    @property
    def is_running(self) -> bool:
        thread = self._thread
        return thread is not None and thread.is_alive()

    def start(self) -> None:
        """Spawn the pump thread. A no-op if already running."""
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run, name="aah-ipc-scheduler", daemon=True
        )
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception as exc:  # noqa: BLE001 - a bad tick must not kill the pump
                if self._on_error is not None:
                    self._on_error(exc)
            self._stop.wait(self._interval_s)

    def stop(self) -> None:
        """Signal the pump to stop and join it (skipping a self-join). Idempotent."""
        self._stop.set()
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=self._join_timeout_s)
        self._thread = None


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

    Services that need a steady loop opt into the host's periodic pump by implementing
    the :class:`TickingService` surface (a ``tick`` method + a positive
    ``tick_interval_s``). The host starts the pump after ``on_enable`` and stops/joins
    it before ``on_disable`` (and on ``on_unload``/:meth:`close`), so the service never
    owns thread lifecycle and a tick never races device teardown.
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
        self._scheduler: _Scheduler | None = None
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
            # Start the pump only once the service is fully enabled (devices acquired).
            self._start_scheduler()
        elif phase == "disable":
            # Stop the pump first so no tick races the service's device teardown.
            self._stop_scheduler()
            await self._service.on_disable()
            self.send_health()
        elif phase == "unload":
            self._stop_scheduler()
            await self._service.on_unload()

    def _start_scheduler(self) -> None:
        """Begin ticking the service if it opts into the periodic pump."""
        if self._scheduler is not None:
            return
        tick = getattr(self._service, "tick", None)
        interval = getattr(self._service, "tick_interval_s", None)
        if not callable(tick) or not isinstance(interval, (int, float)) or interval <= 0:
            return
        scheduler = _Scheduler(tick, float(interval))
        scheduler.start()
        self._scheduler = scheduler

    def _stop_scheduler(self) -> None:
        """Stop and join the pump if running. Idempotent."""
        scheduler = self._scheduler
        if scheduler is not None:
            scheduler.stop()
            self._scheduler = None

    def send_health(self) -> None:
        """Emit a ``health`` frame reflecting the service's current health."""
        self._channel.send(HealthFrame(status=self._service.health_check()))

    def close(self) -> None:
        """Stop the pump and stop listening for frames from the channel."""
        self._stop_scheduler()
        self._unsubscribe()



# ---------------------------------------------------------------------------
# StdioChannel — a real Channel over newline-delimited JSON on byte streams
# ---------------------------------------------------------------------------
class StdioChannel:
    """A concrete :class:`Channel` over NDJSON frames on binary streams.

    Mirror of the TS ``StdioChannel``: serialize each frame with
    :func:`encode_frame` as a single ``\\n``-terminated line on ``output``, and parse
    each complete line read from ``input`` with :func:`decode_frame`. Defaults wire up
    the process's real stdin/stdout so ``python -m <service>`` can host over stdio.

    Reads are driven by the blocking :meth:`serve` loop (one line at a time, returning
    at EOF). A line that fails to decode is reported to ``on_error`` and skipped — it
    does not abort the loop. Empty lines are ignored. The channel does not own the
    streams it is handed; :meth:`close` only stops dispatching.
    """

    def __init__(
        self,
        input: BinaryIO | None = None,
        output: BinaryIO | None = None,
        *,
        on_error: Callable[[Exception, str], None] | None = None,
    ) -> None:
        self._input: BinaryIO = input if input is not None else sys.stdin.buffer
        self._output: BinaryIO = output if output is not None else sys.stdout.buffer
        self._handlers: set[FrameHandler] = set()
        self._on_error = on_error
        self._closed = False
        # The host's periodic scheduler may emit from its own thread while the serve
        # loop writes health frames — serialize writes so lines never interleave.
        self._write_lock = threading.Lock()

    def send(self, frame: Frame) -> None:
        if self._closed:
            return
        data = encode_frame(frame).encode("utf-8") + b"\n"
        with self._write_lock:
            self._output.write(data)
            self._output.flush()

    def on_message(self, handler: FrameHandler) -> Callable[[], None]:
        self._handlers.add(handler)

        def unsubscribe() -> None:
            self._handlers.discard(handler)

        return unsubscribe

    def close(self) -> None:
        self._closed = True
        self._handlers.clear()

    def serve(self) -> None:
        """Read and dispatch frames line-by-line until ``input`` reaches EOF."""
        for raw in self._input:
            if self._closed:
                break
            self._dispatch_line(raw)

    def _dispatch_line(self, raw: bytes) -> None:
        # Strip the trailing newline (and a possible CR from a CRLF transport).
        line = raw.decode("utf-8").rstrip("\r\n")
        if not line:
            return  # ignore blank lines
        try:
            frame = decode_frame(line)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            if self._on_error is not None:
                self._on_error(exc, line)
            return
        for handler in list(self._handlers):
            handler(frame)


def run_stdio_host(
    service: AccessibilityService,
    *,
    config: dict[str, Any] | None = None,
) -> None:
    """Host ``service`` over the process's real stdin/stdout and block until EOF.

    Builds a :class:`StdioChannel` on ``sys.stdin.buffer``/``sys.stdout.buffer``, wraps
    the service in a :class:`ServiceHost` (so inbound ``lifecycle`` frames drive its
    hooks and ``health``/``event`` frames flow back out), and runs the channel's
    blocking serve loop. The reusable entrypoint for a ``python -m <service>`` module;
    wiring a specific service's ``__main__`` is left to that service.
    """
    channel = StdioChannel()
    ServiceHost(service, channel, config=config)
    channel.serve()

 
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
    "TickingService",
    "ServiceHost",
    "StdioChannel",
    "run_stdio_host",
]
