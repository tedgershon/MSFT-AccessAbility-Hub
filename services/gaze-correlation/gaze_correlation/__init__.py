"""Gaze correlation service (Python).

Consumes camera and display frame metadata and emits correlated gaze metadata.
This is a skeleton that validates end-to-end event wiring before advanced CV.
"""

from __future__ import annotations

from time import time_ns
from typing import Any

from aah_contracts import (
    AccessibilityService,
    HealthStatus,
    ServiceContext,
    ServiceMeta,
    healthy,
)


class GazeCorrelationService(AccessibilityService):
    meta = ServiceMeta(id="gaze-correlation", name="Gaze Correlation", version="0.1.0")
    requires = []

    def __init__(self) -> None:
        self._ctx: ServiceContext | None = None
        self._active = False
        self._latest_camera_ref: dict[str, Any] | None = None
        self._latest_display_ref: dict[str, Any] | None = None

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx

    async def on_enable(self) -> None:
        self._active = True
        self._emit_calibration_state("collecting")

    async def on_disable(self) -> None:
        self._emit_calibration_state("idle")
        self._active = False

    async def on_unload(self) -> None:
        self._ctx = None
        self._latest_camera_ref = None
        self._latest_display_ref = None

    def health_check(self) -> HealthStatus:
        return healthy("correlating" if self._active else "idle")

    def ingest_camera_frame_ref(self, payload: dict[str, Any]) -> None:
        self._latest_camera_ref = payload
        self._maybe_emit_gaze_point()

    def ingest_display_frame_ref(self, payload: dict[str, Any]) -> None:
        self._latest_display_ref = payload
        self._maybe_emit_gaze_point()

    def _maybe_emit_gaze_point(self) -> None:
        if not self._active or self._ctx is None:
            return
        camera = self._latest_camera_ref
        display = self._latest_display_ref
        if camera is None or display is None:
            return

        display_width = int(display.get("width", 0))
        display_height = int(display.get("height", 0))
        if display_width <= 0 or display_height <= 0:
            return

        # Skeleton mapping: midpoint gaze until geometric calibration is wired.
        self._ctx.bus.emit(
            "gaze/point",
            {
                "sourceServiceId": self.meta.id,
                "capturedAtMs": time_ns() // 1_000_000,
                "x": display_width / 2,
                "y": display_height / 2,
                "confidence": 0.5,
            },
        )
        self._emit_calibration_state("ready")

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
