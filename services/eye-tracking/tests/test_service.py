"""Eye-tracking service tests (hardware-free via an injected fake camera).

Asserts the capability manifest is unchanged and that the camera lease is
opened/closed exactly once across an enable/disable cycle (contract rule 5).
"""

from __future__ import annotations

import asyncio

from aah_contracts import Capability, ServiceContext
from eye_tracking import EyeTrackingService


class FakeCamera:
    """Deterministic, hardware-free stand-in for `CameraAdapter`."""

    def __init__(self) -> None:
        self.open_count = 0
        self.close_count = 0
        self.is_open = False

    def open(self) -> None:
        self.open_count += 1
        self.is_open = True

    def read(self) -> object:
        return None

    def close(self) -> None:
        self.close_count += 1
        self.is_open = False


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
