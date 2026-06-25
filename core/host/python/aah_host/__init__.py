"""Out-of-process host runtime for Python services.

Compute-heavy services (eye tracking, gaze correlation, ...) run in their own
process and reach the kernel only across the IPC seam — never via direct calls. This
module is the Python half of that seam: it owns a small in-process bus the hosted
services subscribe to, and pumps events to/from the kernel as newline-delimited JSON
on stdio. The TS half is ``IpcEventBridge`` in ``@aah/kernel``.

Wire frame: ``{"topic": <str>, "payload": <json-value>}`` per line.
"""

from __future__ import annotations

import asyncio
import json
import sys
from collections.abc import Callable, Iterable, Sequence
from typing import Any, TextIO

from aah_contracts import AccessibilityService, ServiceContext

__all__ = ["HostBus", "run_stdio_host"]


class HostBus:
    """Minimal in-process pub/sub mirroring the TS ``EventBus`` (on/emit).

    Hosted services receive this as ``ServiceContext.bus`` and never know whether a
    peer is local or across the IPC seam.
    """

    def __init__(self) -> None:
        self._handlers: dict[str, list[Callable[[Any], None]]] = {}

    def on(self, topic: str, handler: Callable[[Any], None]) -> Callable[[], None]:
        self._handlers.setdefault(topic, []).append(handler)

        def dispose() -> None:
            handlers = self._handlers.get(topic)
            if handlers and handler in handlers:
                handlers.remove(handler)

        return dispose

    def emit(self, topic: str, payload: Any) -> None:
        # Copy so a handler that (un)subscribes mid-dispatch cannot mutate the loop.
        for handler in list(self._handlers.get(topic, [])):
            handler(payload)


def run_stdio_host(
    services: Sequence[AccessibilityService],
    *,
    inbound: Iterable[str],
    outbound: Iterable[str],
    stdin: TextIO | None = None,
    stdout: TextIO | None = None,
    config: dict[str, Any] | None = None,
) -> None:
    """Host ``services`` and bridge their bus over NDJSON stdio until stdin EOF.

    ``inbound`` topics arriving from the kernel are emitted on the local bus;
    events the services emit on the ``outbound`` allowlist are written back to the
    kernel. On EOF the services are torn down in reverse (``on_disable`` then
    ``on_unload``) so camera/mic leases are released (contract rule 5).
    """
    source = sys.stdin if stdin is None else stdin
    sink = sys.stdout if stdout is None else stdout
    bus = HostBus()
    inbound_set = set(inbound)

    def make_writer(topic: str) -> Callable[[Any], None]:
        def write(payload: Any) -> None:
            sink.write(json.dumps({"topic": topic, "payload": payload}) + "\n")
            sink.flush()

        return write

    for topic in outbound:
        bus.on(topic, make_writer(topic))

    base_config = config or {}
    for service in services:
        ctx = ServiceContext(self_id=service.meta.id, bus=bus, config=dict(base_config))
        asyncio.run(service.on_load(ctx))
        asyncio.run(service.on_enable())

    try:
        for raw_line in source:
            line = raw_line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            topic = message.get("topic")
            if topic in inbound_set:
                bus.emit(topic, message.get("payload"))
    finally:
        for service in reversed(services):
            asyncio.run(service.on_disable())
            asyncio.run(service.on_unload())
