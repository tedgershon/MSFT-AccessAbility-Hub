"""Unit tests for eye-tracking event emission skeleton."""

from __future__ import annotations

import asyncio
from aah_contracts import ServiceContext
from eye_tracking import EyeTrackingService


def make_ctx(bus) -> ServiceContext:
    return ServiceContext(self_id="eye-tracking", bus=bus, config={})


def test_on_enable_emits_bootstrap_frame_and_calibration(capturing_bus) -> None:
    svc = EyeTrackingService()
    asyncio.run(svc.on_load(make_ctx(capturing_bus)))

    asyncio.run(svc.on_enable())

    assert svc.health_check().detail == "tracking"
    topics = [topic for topic, _payload in capturing_bus.emitted]
    assert "calibration/state" in topics
    assert "camera/frame-ref" in topics

    frame_payload = next(payload for topic, payload in capturing_bus.emitted if topic == "camera/frame-ref")
    assert frame_payload["sourceServiceId"] == "eye-tracking"
    assert frame_payload["width"] == 640
    assert frame_payload["height"] == 360
    assert frame_payload["frameId"] == "bootstrap"


def test_publish_frame_ref_emits_metadata(capturing_bus) -> None:
    svc = EyeTrackingService()
    asyncio.run(svc.on_load(make_ctx(capturing_bus)))

    svc.publish_frame_ref(width=1920, height=1080, frame_id="frame-123")

    topic, payload = capturing_bus.emitted[-1]
    assert topic == "camera/frame-ref"
    assert payload["sourceServiceId"] == "eye-tracking"
    assert payload["width"] == 1920
    assert payload["height"] == 1080
    assert payload["frameId"] == "frame-123"


def test_on_disable_emits_idle_calibration(capturing_bus) -> None:
    svc = EyeTrackingService()
    asyncio.run(svc.on_load(make_ctx(capturing_bus)))
    asyncio.run(svc.on_enable())

    asyncio.run(svc.on_disable())

    assert svc.health_check().detail == "idle"
    states = [payload["state"] for topic, payload in capturing_bus.emitted if topic == "calibration/state"]
    assert "idle" in states
