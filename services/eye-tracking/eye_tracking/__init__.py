"""Eye-tracking service (Python).

Strongest CV ecosystem lives in Python (OpenCV, MediaPipe). Runs in its own
process so a CV segfault cannot take down voice control or the shell. Declares
``camera: exclusive`` and ``cursor: shared``; the camera lease MUST be released in
``on_disable`` (contract rule 5).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from time import time_ns
from typing import Any, Literal, Protocol

from aah_contracts import (
    AccessibilityService,
    Capability,
    HealthStatus,
    ServiceContext,
    ServiceMeta,
    healthy,
)

ProviderName = Literal["synthetic", "webcam", "windows"]


@dataclass(frozen=True, slots=True)
class ProviderGazeReading:
    x: float
    y: float
    confidence: float
    provider: ProviderName
    frame_width: int | None = None
    frame_height: int | None = None
    frame_id: str | None = None


class GazeProvider(Protocol):
    name: ProviderName

    def open(self) -> None:
        ...

    def read(self) -> ProviderGazeReading | None:
        ...

    def close(self) -> None:
        ...


class SyntheticGazeProvider:
    """Hardware-free provider for demos, tests, and CI."""

    name: ProviderName = "synthetic"

    def open(self) -> None:
        pass

    def read(self) -> ProviderGazeReading:
        return ProviderGazeReading(
            x=0.5,
            y=0.5,
            confidence=0.6,
            provider=self.name,
            frame_width=640,
            frame_height=360,
            frame_id="bootstrap",
        )

    def close(self) -> None:
        pass


class WebcamGazeProvider:
    """Webcam provider backed by the existing OpenCV/MediaPipe gaze estimator."""

    name: ProviderName = "webcam"

    def __init__(self, *, device_index: int = 0) -> None:
        self._device_index = device_index
        self._camera: Any | None = None
        self._estimator: Any | None = None
        self._frame_index = 0

    def open(self) -> None:
        from camera_adapter import CameraAdapter

        from .gaze import GazeEstimator

        self._camera = CameraAdapter(device_index=self._device_index)
        self._camera.open()
        self._estimator = GazeEstimator()

    def read(self) -> ProviderGazeReading | None:
        if self._camera is None or self._estimator is None:
            raise RuntimeError("webcam gaze provider is not open")
        frame = self._camera.read()
        if frame is None:
            return None
        height, width = frame.shape[:2]
        reading = self._estimator.process(frame)
        if reading.feature is None:
            return None
        self._frame_index += 1
        return ProviderGazeReading(
            x=reading.feature[0],
            y=reading.feature[1],
            confidence=0.7,
            provider=self.name,
            frame_width=width,
            frame_height=height,
            frame_id=f"webcam-{self._frame_index}",
        )

    def close(self) -> None:
        if self._estimator is not None:
            self._estimator.close()
            self._estimator = None
        if self._camera is not None:
            self._camera.close()
            self._camera = None


class WindowsGazeProvider:
    """Integration seam for Windows Eye Control compatible gaze hardware.

    Windows' built-in Eye Control remains the recommended OS-level fallback. This
    provider exists so a native WinRT bridge can be dropped in later without
    changing the hub event contracts.
    """

    name: ProviderName = "windows"

    def open(self) -> None:
        raise RuntimeError(
            "Windows gaze provider requires a WinRT bridge with the gazeInput "
            "capability; use Windows Eye Control directly or AAH_GAZE_PROVIDER=webcam."
        )

    def read(self) -> None:
        return None

    def close(self) -> None:
        pass


class EyeTrackingService(AccessibilityService):
    meta = ServiceMeta(id="eye-tracking", name="Eye Tracking", version="0.1.0")
    requires = [
        Capability(resource="camera", mode="exclusive"),
        Capability(resource="cursor", mode="shared"),
    ]

    def __init__(self, provider: GazeProvider | None = None) -> None:
        self._ctx: ServiceContext | None = None
        self._active = False
        self._provider = provider

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx

    async def on_enable(self) -> None:
        self._active = True
        try:
            provider = self._ensure_provider()
            provider.open()
            self._emit_calibration_state("collecting")
            reading = provider.read()
            if reading is not None:
                if reading.frame_width is not None and reading.frame_height is not None:
                    self.publish_frame_ref(
                        width=reading.frame_width,
                        height=reading.frame_height,
                        frame_id=reading.frame_id,
                    )
                self.publish_camera_gaze(reading)
        except RuntimeError as exc:
            self._emit_calibration_state("degraded", details={"error": str(exc)})

    async def on_disable(self) -> None:
        if self._provider is not None:
            self._provider.close()
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

    def publish_camera_gaze(self, reading: ProviderGazeReading) -> None:
        """Publish a normalized provider-space gaze estimate for screen correlation."""
        if self._ctx is None:
            return
        self._ctx.bus.emit(
            "camera/gaze",
            {
                "sourceServiceId": self.meta.id,
                "capturedAtMs": time_ns() // 1_000_000,
                "x": max(0.0, min(1.0, reading.x)),
                "y": max(0.0, min(1.0, reading.y)),
                "confidence": max(0.0, min(1.0, reading.confidence)),
                "provider": reading.provider,
            },
        )

    def _ensure_provider(self) -> GazeProvider:
        if self._provider is not None:
            return self._provider
        config = self._ctx.config if self._ctx is not None else {}
        default_provider = os.environ.get("AAH_GAZE_PROVIDER", "synthetic")
        mode = str(config.get("eyeTrackingProvider", default_provider))
        if mode == "webcam":
            self._provider = WebcamGazeProvider()
        elif mode == "windows":
            self._provider = WindowsGazeProvider()
        else:
            self._provider = SyntheticGazeProvider()
        return self._provider

    def _emit_calibration_state(
        self, state: str, *, details: dict[str, Any] | None = None
    ) -> None:
        if self._ctx is None:
            return
        payload: dict[str, Any] = {
            "sourceServiceId": self.meta.id,
            "capturedAtMs": time_ns() // 1_000_000,
            "state": state,
        }
        if details is not None:
            payload["details"] = details
        self._ctx.bus.emit("calibration/state", payload)
