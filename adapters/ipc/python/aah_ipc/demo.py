"""A trivial demo service that proves the stdio transport end-to-end.

This is INFRASTRUCTURE, not a tile: it implements no accessibility feature. The host
spawns it (``python -m aah_ipc.demo``), drives its lifecycle over the IPC seam, and
reads back a health frame — exercising the full lifecycle -> child -> health path over
a real process boundary.
"""

from __future__ import annotations

from aah_contracts import (
    AccessibilityService,
    Capability,
    HealthStatus,
    ServiceContext,
    ServiceMeta,
    degraded,
    healthy,
)

from . import run_stdio_host


class DemoService(AccessibilityService):
    """Reports ``healthy`` once enabled, ``degraded`` otherwise. No resources, no work."""

    meta = ServiceMeta(id="ipc-demo", name="IPC Demo", version="0.1.0")
    requires: list[Capability] = []

    def __init__(self) -> None:
        self._active = False

    async def on_load(self, _ctx: ServiceContext) -> None:
        return None

    async def on_enable(self) -> None:
        self._active = True

    async def on_disable(self) -> None:
        self._active = False

    async def on_unload(self) -> None:
        return None

    def health_check(self) -> HealthStatus:
        return healthy("demo running") if self._active else degraded("demo not enabled")


def main() -> None:
    run_stdio_host(DemoService())


if __name__ == "__main__":
    main()
