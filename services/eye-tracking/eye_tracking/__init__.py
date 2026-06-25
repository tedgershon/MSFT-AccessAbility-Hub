"""Eye-tracking service (Python).

Strongest CV ecosystem lives in Python (OpenCV, MediaPipe). Runs in its own
process so a CV segfault cannot take down voice control or the shell. Declares
``camera: exclusive`` and ``cursor: shared``; the camera lease MUST be released in
``on_disable`` (contract rule 5).
"""

from __future__ import annotations

from time import time_ns

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
        self._emit_calibration_state("collecting")
        # Skeleton plumbing: publish one bootstrap frame reference so downstream
        # consumers (correlation service, telemetry) can validate bus wiring.
        self.publish_frame_ref(width=640, height=360, frame_id="bootstrap")

    async def on_disable(self) -> None:
        # TODO: stop the pipeline and RELEASE the camera (rule 5).
        self._emit_calibration_state("idle")
        self._active = False

    async def on_unload(self) -> None:
        self._ctx = None

    def health_check(self) -> HealthStatus:
        return healthy("tracking" if self._active else "idle")

    def publish_frame_ref(self, *, width: int, height: int, frame_id: str | None = None) -> None:
        """Publish camera frame metadata onto the shared event bus.

        The actual frame bytes stay out-of-band; this metadata is enough for
        correlation and command-context pipelines to align data streams.
        """
        if self._ctx is None:
            return
        self._ctx.bus.emit(
            "camera/frame-ref",
            {
                "sourceServiceId": self.meta.id,
                "capturedAtMs": time_ns() // 1_000_000,
                "frameId": frame_id,
                "width": width,
                "height": height,
            },
        )

    def _emit_calibration_state(self, state: str) -> None:
        if self._ctx is None:
            return
        self._ctx.bus.emit(
            "calibration/state",
            {
                "sourceServiceId": self.meta.id,
                "capturedAtMs": time_ns() // 1_000_000,
                "state": state,
            },
        )
