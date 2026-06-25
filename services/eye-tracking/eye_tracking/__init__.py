"""Eye-tracking service (Python).

Strongest CV ecosystem lives in Python (OpenCV, MediaPipe). Runs in its own
process so a CV segfault cannot take down voice control or the shell. Declares
``camera: exclusive`` and ``cursor: shared``; the camera lease MUST be released in
``on_disable`` (contract rule 5).

It is the sole source of the gaze-to-screen ``input/target-hint`` event: other
services (e.g. ``pointing-magnifier``, issue #22) consume that hint over the event
bus rather than opening the camera themselves, since ``camera`` is an exclusive
resource and only one holder is allowed at a time. The motor & dexterity "Input
Assist" tile (issue #31) is built on this: the magnifier follows the hint, and the
``input-personalization`` dwell timer turns a stable hint into a click — the
dwell-selection method that webcam and dedicated eye trackers share (cf. Microsoft
Eye Control; Chhimpa et al. 2023, real-time webcam gaze under natural head motion).

Gaze estimation is pluggable behind :class:`GazeSource`. The default
:class:`SyntheticGazeSource` is hardware-free so the whole path is demoable and
CI-testable without an eye tracker; a MediaPipe/OpenCV source (issues #9-12) slots
in behind the same Protocol without any consumer changing.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from aah_contracts import (
    INPUT_TARGET_HINT,
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


@dataclass(frozen=True, slots=True)
class GazeReading:
    """A gaze estimate already projected into screen-pixel coordinates.

    ``confidence`` is in ``[0, 1]``; downstream consumers (magnifier follow, dwell
    selection) may gate on it so a low-quality estimate doesn't move the pointer.
    """

    x: float
    y: float
    confidence: float


@runtime_checkable
class GazeSource(Protocol):
    """Turns a camera frame into a screen-space :class:`GazeReading` (or ``None``).

    Returning ``None`` means "no usable gaze this frame" (e.g. no face detected);
    the service simply emits nothing for that frame.
    """

    def estimate(self, frame: object) -> GazeReading | None: ...


class SyntheticGazeSource:
    """Deterministic, hardware-free gaze source for demos, tests, and CI.

    Ignores frame pixels and replays a fixed (or supplied) sequence of screen
    points, so the Input Assist path can run end-to-end with no eye tracker. A real
    MediaPipe/OpenCV estimator (issues #9-12) implements the same :class:`GazeSource`
    Protocol and is a drop-in replacement.
    """

    def __init__(
        self,
        points: list[tuple[float, float]] | None = None,
        *,
        confidence: float = 0.9,
    ) -> None:
        self._points = list(points) if points else [(960.0, 540.0)]
        self._confidence = confidence
        self._index = 0

    def estimate(self, frame: object) -> GazeReading | None:
        if frame is None:
            return None
        x, y = self._points[self._index % len(self._points)]
        self._index += 1
        return GazeReading(x=float(x), y=float(y), confidence=self._confidence)


class EyeTrackingService(AccessibilityService):
    meta = ServiceMeta(id="eye-tracking", name="Eye Tracking", version="0.1.0")
    requires = [
        Capability(resource="camera", mode="exclusive"),
        Capability(resource="cursor", mode="shared"),
    ]

    def __init__(
        self,
        *,
        camera: Camera | None = None,
        gaze_source: GazeSource | None = None,
    ) -> None:
        self._ctx: ServiceContext | None = None
        self._camera: Camera = camera if camera is not None else CameraAdapter()
        self._gaze: GazeSource = gaze_source if gaze_source is not None else SyntheticGazeSource()
        self._active = False
        self._last: GazeReading | None = None

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx

    async def on_enable(self) -> None:
        self._camera.open()
        self._active = True
        # Emit an initial hint so consumers (magnifier, dwell) have a target as soon
        # as a frame is available; harmless no-op if the camera has no frame yet.
        self.poll_once()

    async def on_disable(self) -> None:
        self._camera.close()  # release the camera lease (rule 5)
        self._active = False
        self._last = None

    async def on_unload(self) -> None:
        self._ctx = None

    def health_check(self) -> HealthStatus:
        if not self._active:
            return healthy("idle")
        return healthy("tracking (hinting)" if self._last is not None else "tracking")

    def poll_once(self) -> GazeReading | None:
        """Read one camera frame, estimate gaze, and emit ``input/target-hint``.

        Returns the :class:`GazeReading` that was emitted, or ``None`` when there is
        no frame yet or the source found no usable gaze. A real run loop calls this
        per captured frame; tests call it to step the pipeline deterministically.
        """
        if not self._active or self._ctx is None:
            return None
        frame = self._camera.read()
        if frame is None:
            return None
        reading = self._gaze.estimate(frame)
        if reading is None:
            return None
        self._last = reading
        self._emit_target_hint(reading)
        return reading

    def _emit_target_hint(self, reading: GazeReading) -> None:
        if self._ctx is None:
            return
        self._ctx.bus.emit(
            INPUT_TARGET_HINT,
            {
                "source": self.meta.id,
                "x": reading.x,
                "y": reading.y,
                "confidence": reading.confidence,
            },
        )
