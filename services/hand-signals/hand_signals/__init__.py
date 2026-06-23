"""Hand-signal / gesture service (Python + FastAPI).

Recognizes hand gestures and exposes them over a small FastAPI surface. Runs in its
own process. Declares ``camera: exclusive`` and ``cursor: shared``; the camera lease
MUST be released in ``on_disable`` (contract rule 5).
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


class HandSignalsService(AccessibilityService):
    meta = ServiceMeta(id="hand-signals", name="Hand Signals", version="0.1.0")
    requires = [
        Capability(resource="camera", mode="exclusive"),
        Capability(resource="cursor", mode="shared"),
    ]

    def __init__(self) -> None:
        self._ctx: ServiceContext | None = None
        self._active = False

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx

    async def on_enable(self) -> None:
        # TODO: open the camera + start the gesture pipeline + FastAPI app.
        self._active = True

    async def on_disable(self) -> None:
        # TODO: stop the pipeline and RELEASE the camera (rule 5).
        self._active = False

    async def on_unload(self) -> None:
        self._ctx = None

    def health_check(self) -> HealthStatus:
        return healthy("recognizing" if self._active else "idle")
