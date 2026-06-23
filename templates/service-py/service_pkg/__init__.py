"""__SERVICE_NAME__ service (Python).

Runs in its own process and talks to the kernel only across the IPC seam (event
bus) — never via direct calls. Depends only on aah_contracts.
"""

from __future__ import annotations

from aah_contracts import (
    AccessibilityService,
    Capability,
    HealthStatus,
    ServiceContext,
    ServiceMeta,
    healthy,
)


class __SERVICE_CLASS__Service(AccessibilityService):
    meta = ServiceMeta(id="__SERVICE_ID__", name="__SERVICE_NAME__", version="0.1.0")

    # Declare ONLY the resources you touch.
    # e.g. [Capability(resource="camera", mode="exclusive")]
    requires: list[Capability] = []

    def __init__(self) -> None:
        self._ctx: ServiceContext | None = None
        self._active = False

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx

    async def on_enable(self) -> None:
        # TODO: acquire resources and start.
        self._active = True

    async def on_disable(self) -> None:
        # TODO: stop and RELEASE every lease here (camera/mic rule).
        self._active = False

    async def on_unload(self) -> None:
        self._ctx = None

    def health_check(self) -> HealthStatus:
        return healthy("active" if self._active else "idle")
