"""Eye-tracking service (Python).

Strongest CV ecosystem lives in Python (OpenCV, MediaPipe). Runs in its own
process so a CV segfault cannot take down voice control or the shell. Declares
``camera: exclusive`` and ``cursor: shared``; the camera lease MUST be released in
``on_disable`` (contract rule 5).

Also the sole source of the gaze-to-screen ``input/target-hint`` event: other
services (e.g. ``pointing-magnifier``, issue #22) consume that hint over the event
bus rather than opening the camera themselves, since ``camera`` is an exclusive
resource and only one holder is allowed at a time.
"""

from __future__ import annotations

from typing import Protocol

from aah_contracts import (
    AccessibilityService,
    Capability,
    HealthStatus,
    ServiceContext,
    ServiceMeta,
    healthy,
)
from camera_adapter import CameraAdapter


class Camera(Protocol):
    """The narrow camera surface this service drives (matches `CameraAdapter`)."""

    def open(self) -> None: ...
    def read(self) -> object: ...
    def close(self) -> None: ...


class EyeTrackingService(AccessibilityService):
    meta = ServiceMeta(id="eye-tracking", name="Eye Tracking", version="0.1.0")
    requires = [
        Capability(resource="camera", mode="exclusive"),
        Capability(resource="cursor", mode="shared"),
    ]

    def __init__(self, *, camera: Camera | None = None) -> None:
        self._ctx: ServiceContext | None = None
        self._camera: Camera = camera if camera is not None else CameraAdapter()
        self._active = False

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx

    async def on_enable(self) -> None:
        self._camera.open()
        # TODO: start the face-detection -> eye-landmark -> gaze-estimation pipeline
        # (issues #9-12) and, once a screen-calibrated gaze point is available, emit
        # `input/target-hint` ({source: "eye-tracking", x, y, confidence}) on
        # self._ctx.bus so pointing-magnifier (and future consumers) can react to it.
        self._active = True

    async def on_disable(self) -> None:
        self._camera.close()  # release the camera lease (rule 5)
        self._active = False

    async def on_unload(self) -> None:
        self._ctx = None

    def health_check(self) -> HealthStatus:
        return healthy("tracking" if self._active else "idle")
