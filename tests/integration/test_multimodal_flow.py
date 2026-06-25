"""Integration flow test for eye-tracking and gaze-correlation services."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from aah_contracts import ServiceContext
from conftest import CapturingBus

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "eye-tracking"))
sys.path.insert(0, str(ROOT / "services" / "gaze-correlation"))

from eye_tracking import EyeTrackingService
from gaze_correlation import GazeCorrelationService


def _ctx(service_id: str, bus: CapturingBus) -> ServiceContext:
    return ServiceContext(self_id=service_id, bus=bus, config={})


def test_eye_tracking_to_correlation_emits_gaze_point() -> None:
    bus = CapturingBus()
    eye = EyeTrackingService()
    corr = GazeCorrelationService()

    asyncio.run(eye.on_load(_ctx("eye-tracking", bus)))
    asyncio.run(corr.on_load(_ctx("gaze-correlation", bus)))
    asyncio.run(eye.on_enable())
    asyncio.run(corr.on_enable())

    corr.add_calibration_sample(camera_x=0.0, camera_y=0.0, screen_x=0, screen_y=0)
    corr.add_calibration_sample(camera_x=1.0, camera_y=1.0, screen_x=1920, screen_y=1080)

    eye.publish_frame_ref(width=640, height=360, frame_id="it-1")
    camera_ref = next(payload for topic, payload in bus.emitted if topic == "camera/frame-ref")

    corr.ingest_camera_frame_ref(camera_ref)
    corr.ingest_display_frame_ref(
        {
            "sourceServiceId": "shell-display-capture",
            "capturedAtMs": 20,
            "width": 1920,
            "height": 1080,
        }
    )
    corr.ingest_camera_gaze(
        {
            "sourceServiceId": "eye-tracking",
            "capturedAtMs": 21,
            "x": 0.25,
            "y": 0.5,
            "confidence": 0.75,
        }
    )

    gaze_events = [payload for topic, payload in bus.emitted if topic == "gaze/point"]
    assert len(gaze_events) == 1
    assert gaze_events[0]["x"] == 480
    assert gaze_events[0]["y"] == 540
    assert gaze_events[0]["confidence"] == 0.75

    asyncio.run(corr.on_disable())
    asyncio.run(eye.on_disable())
