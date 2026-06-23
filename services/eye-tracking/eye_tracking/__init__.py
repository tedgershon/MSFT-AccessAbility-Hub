"""Eye-tracking service (Python).

Strongest CV ecosystem lives in Python (OpenCV, MediaPipe). Runs in its own
process so a CV segfault cannot take down voice control or the shell. Declares
``camera: exclusive`` and ``cursor: shared``; the camera lease MUST be released in
``on_disable`` (contract rule 5).
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


class EyeTrackingService(AccessibilityService):
    meta = ServiceMeta(id="eye-tracking", name="Eye Tracking", version="0.1.0")
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
        # TODO: open the camera + start the gaze pipeline.
        self._active = True

    async def on_disable(self) -> None:
        # TODO: stop the pipeline and RELEASE the camera (rule 5).
        self._active = False

    async def on_unload(self) -> None:
        self._ctx = None

    def health_check(self) -> HealthStatus:
        return healthy("tracking" if self._active else "idle")
