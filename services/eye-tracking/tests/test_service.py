"""Eye-tracking service tests (hardware-free via an injected fake camera).

Asserts the capability manifest is unchanged, that the camera lease is
opened/closed exactly once across an enable/disable cycle (contract rule 5), and
that the service emits a screen-space ``input/target-hint`` from its gaze source so
consumers (pointing-magnifier, dwell selection) can react.
"""

from __future__ import annotations

import asyncio

from aah_contracts import Capability, ServiceContext
from eye_tracking import EyeTrackingService, GazeReading, SyntheticGazeSource


class FakeCamera:
    """Deterministic, hardware-free stand-in for `CameraAdapter`.

    ``read()`` returns ``None`` (no frame) unless ``frame`` is supplied, so tests
    can choose whether a gaze estimate is produced.
    """

    def __init__(self, frame: object = None) -> None:
        self.open_count = 0
        self.close_count = 0
        self.is_open = False
        self._frame = frame

    def open(self) -> None:
        self.open_count += 1
        self.is_open = True

    def read(self) -> object:
        return self._frame

    def close(self) -> None:
        self.close_count += 1
        self.is_open = False


def _hints(bus) -> list[dict]:
    return [payload for topic, payload in bus.emitted if topic == "input/target-hint"]


def test_requires_exclusive_camera_and_shared_cursor() -> None:
    service = EyeTrackingService(camera=FakeCamera())
    assert service.requires == [
        Capability(resource="camera", mode="exclusive"),
        Capability(resource="cursor", mode="shared"),
    ]


def test_on_enable_opens_the_camera(capturing_bus) -> None:
    camera = FakeCamera()
    service = EyeTrackingService(camera=camera)
    ctx = ServiceContext(self_id="eye-tracking", bus=capturing_bus, config={})

    async def run() -> None:
        await service.on_load(ctx)
        await service.on_enable()

    asyncio.run(run())

    assert camera.open_count == 1
    assert camera.is_open is True
    assert service.health_check().detail == "tracking"


def test_on_disable_releases_the_camera_lease(capturing_bus) -> None:
    camera = FakeCamera()
    service = EyeTrackingService(camera=camera)
    ctx = ServiceContext(self_id="eye-tracking", bus=capturing_bus, config={})

    async def run() -> None:
        await service.on_load(ctx)
        await service.on_enable()
        await service.on_disable()

    asyncio.run(run())

    assert camera.close_count == 1
    assert camera.is_open is False
    assert service.health_check().detail == "idle"


def test_no_target_hint_emitted_without_a_frame(capturing_bus) -> None:
    # Default camera yields no frame, so there is nothing to estimate gaze from.
    service = EyeTrackingService(camera=FakeCamera())
    ctx = ServiceContext(self_id="eye-tracking", bus=capturing_bus, config={})

    async def run() -> None:
        await service.on_load(ctx)
        await service.on_enable()

    asyncio.run(run())

    assert _hints(capturing_bus) == []


def test_on_enable_emits_bootstrap_target_hint(capturing_bus) -> None:
    camera = FakeCamera(frame=object())
    source = SyntheticGazeSource(points=[(100.0, 200.0)], confidence=0.8)
    service = EyeTrackingService(camera=camera, gaze_source=source)
    ctx = ServiceContext(self_id="eye-tracking", bus=capturing_bus, config={})

    async def run() -> None:
        await service.on_load(ctx)
        await service.on_enable()

    asyncio.run(run())

    hints = _hints(capturing_bus)
    assert len(hints) == 1
    assert hints[0] == {
        "source": "eye-tracking",
        "x": 100.0,
        "y": 200.0,
        "confidence": 0.8,
    }
    assert service.health_check().detail == "tracking (hinting)"


def test_poll_once_streams_successive_gaze_points(capturing_bus) -> None:
    camera = FakeCamera(frame=object())
    source = SyntheticGazeSource(points=[(10.0, 10.0), (20.0, 40.0)], confidence=0.5)
    service = EyeTrackingService(camera=camera, gaze_source=source)
    ctx = ServiceContext(self_id="eye-tracking", bus=capturing_bus, config={})

    async def run() -> None:
        await service.on_load(ctx)
        await service.on_enable()  # emits point 0

    asyncio.run(run())
    second = service.poll_once()  # emits point 1

    assert isinstance(second, GazeReading)
    assert (second.x, second.y) == (20.0, 40.0)
    coords = [(h["x"], h["y"]) for h in _hints(capturing_bus)]
    assert coords == [(10.0, 10.0), (20.0, 40.0)]


def test_poll_once_is_inert_after_disable(capturing_bus) -> None:
    camera = FakeCamera(frame=object())
    service = EyeTrackingService(
        camera=camera, gaze_source=SyntheticGazeSource(points=[(1.0, 2.0)])
    )
    ctx = ServiceContext(self_id="eye-tracking", bus=capturing_bus, config={})

    async def run() -> None:
        await service.on_load(ctx)
        await service.on_enable()
        await service.on_disable()

    asyncio.run(run())
    assert service.poll_once() is None
    # Only the bootstrap hint from on_enable, nothing after disable.
    assert len(_hints(capturing_bus)) == 1
