"""Gaze correlation service (Python).

Consumes camera and display frame metadata and emits correlated gaze metadata.
This is a skeleton that validates end-to-end event wiring before advanced CV.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
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
        self._latest_camera_gaze: dict[str, Any] | None = None
        self._calibration_samples: list[CalibrationSample] = []
        self._unsubscribes: list[Callable[[], None]] = []
        self._x_scale = 1.0
        self._x_offset = 0.0
        self._y_scale = 1.0
        self._y_offset = 0.0

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx
        self._subscribe_to_bus(ctx)

    async def on_enable(self) -> None:
        self._active = True
        self._emit_calibration_state("collecting")

    async def on_disable(self) -> None:
        self._emit_calibration_state("idle")
        self._active = False

    async def on_unload(self) -> None:
        for unsubscribe in self._unsubscribes:
            unsubscribe()
        self._unsubscribes.clear()
        self._ctx = None
        self._latest_camera_ref = None
        self._latest_display_ref = None
        self._latest_camera_gaze = None
        self._calibration_samples.clear()

    def health_check(self) -> HealthStatus:
        return healthy("correlating" if self._active else "idle")

    def _subscribe_to_bus(self, ctx: ServiceContext) -> None:
        """Wire ingest handlers to the live event bus.

        The kernel bus client mirrors the TS ``EventBus.on(topic, handler)`` shape,
        returning an unsubscribe callable. Subscribing is optional so emit-only test
        stubs (which omit ``on``) keep working; real runtime ingestion happens here.
        """
        subscribe = getattr(ctx.bus, "on", None)
        if not callable(subscribe):
            return
        self._unsubscribes.append(subscribe("camera/frame-ref", self.ingest_camera_frame_ref))
        self._unsubscribes.append(subscribe("camera/gaze", self.ingest_camera_gaze))
        self._unsubscribes.append(subscribe("display/frame-ref", self.ingest_display_frame_ref))

    def ingest_camera_frame_ref(self, payload: dict[str, Any]) -> None:
        self._latest_camera_ref = payload

    def ingest_display_frame_ref(self, payload: dict[str, Any]) -> None:
        self._latest_display_ref = payload
        self._maybe_emit_gaze_point()

    def ingest_camera_gaze(self, payload: dict[str, Any]) -> None:
        """Ingest eye-tracking gaze estimate in camera coordinate space."""
        self._latest_camera_gaze = payload
        self._maybe_emit_gaze_point()

    def add_calibration_sample(
        self,
        *,
        camera_x: float,
        camera_y: float,
        screen_x: float,
        screen_y: float,
    ) -> None:
        self._calibration_samples.append(
            CalibrationSample(
                camera_x=camera_x,
                camera_y=camera_y,
                screen_x=screen_x,
                screen_y=screen_y,
            )
        )
        self._recompute_transform()
        if self._is_calibrated():
            self._emit_calibration_state("ready")

    def _maybe_emit_gaze_point(self) -> None:
        if not self._active or self._ctx is None:
            return
        camera_gaze = self._latest_camera_gaze
        display = self._latest_display_ref
        if camera_gaze is None or display is None or not self._is_calibrated():
            return

        display_width = int(display.get("width", 0))
        display_height = int(display.get("height", 0))
        if display_width <= 0 or display_height <= 0:
            return

        gaze_x = float(camera_gaze.get("x", 0.0))
        gaze_y = float(camera_gaze.get("y", 0.0))
        mapped_x = (self._x_scale * gaze_x) + self._x_offset
        mapped_y = (self._y_scale * gaze_y) + self._y_offset
        clamped_x = min(max(mapped_x, 0.0), float(display_width))
        clamped_y = min(max(mapped_y, 0.0), float(display_height))
        confidence = float(camera_gaze.get("confidence", 0.0))

        self._ctx.bus.emit(
            "gaze/point",
            {
                "sourceServiceId": self.meta.id,
                "capturedAtMs": time_ns() // 1_000_000,
                "x": clamped_x,
                "y": clamped_y,
                "confidence": confidence,
            },
        )

    def _is_calibrated(self) -> bool:
        return len(self._calibration_samples) >= 2

    def _recompute_transform(self) -> None:
        if len(self._calibration_samples) < 2:
            return

        min_cam_x = min(sample.camera_x for sample in self._calibration_samples)
        max_cam_x = max(sample.camera_x for sample in self._calibration_samples)
        min_cam_y = min(sample.camera_y for sample in self._calibration_samples)
        max_cam_y = max(sample.camera_y for sample in self._calibration_samples)
        min_screen_x = min(sample.screen_x for sample in self._calibration_samples)
        max_screen_x = max(sample.screen_x for sample in self._calibration_samples)
        min_screen_y = min(sample.screen_y for sample in self._calibration_samples)
        max_screen_y = max(sample.screen_y for sample in self._calibration_samples)

        if max_cam_x == min_cam_x or max_cam_y == min_cam_y:
            return

        self._x_scale = (max_screen_x - min_screen_x) / (max_cam_x - min_cam_x)
        self._x_offset = min_screen_x - (self._x_scale * min_cam_x)
        self._y_scale = (max_screen_y - min_screen_y) / (max_cam_y - min_cam_y)
        self._y_offset = min_screen_y - (self._y_scale * min_cam_y)

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


@dataclass(frozen=True, slots=True)
class CalibrationSample:
    camera_x: float
    camera_y: float
    screen_x: float
    screen_y: float
