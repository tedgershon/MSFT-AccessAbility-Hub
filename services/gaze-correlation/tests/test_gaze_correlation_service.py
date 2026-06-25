"""Unit tests for gaze-correlation service skeleton."""

from __future__ import annotations

import asyncio

from aah_contracts import ServiceContext
from gaze_correlation import GazeCorrelationService


def make_ctx(bus) -> ServiceContext:
    return ServiceContext(self_id="gaze-correlation", bus=bus, config={})


def test_on_enable_and_disable_emit_calibration_states(capturing_bus) -> None:
    svc = GazeCorrelationService()
    asyncio.run(svc.on_load(make_ctx(capturing_bus)))

    asyncio.run(svc.on_enable())
    asyncio.run(svc.on_disable())

    states = [payload["state"] for topic, payload in capturing_bus.emitted if topic == "calibration/state"]
    assert "collecting" in states
    assert "idle" in states


def test_ingesting_frame_refs_emits_gaze_point_when_active(capturing_bus) -> None:
    svc = GazeCorrelationService()
    asyncio.run(svc.on_load(make_ctx(capturing_bus)))
    asyncio.run(svc.on_enable())

    svc.ingest_camera_frame_ref(
        {
            "sourceServiceId": "eye-tracking",
            "capturedAtMs": 1,
            "width": 640,
            "height": 360,
        }
    )
    svc.ingest_display_frame_ref(
        {
            "sourceServiceId": "shell-display-capture",
            "capturedAtMs": 2,
            "width": 1920,
            "height": 1080,
        }
    )

    gaze_payloads = [payload for topic, payload in capturing_bus.emitted if topic == "gaze/point"]
    assert len(gaze_payloads) == 1
    assert gaze_payloads[0]["sourceServiceId"] == "gaze-correlation"
    assert gaze_payloads[0]["x"] == 960
    assert gaze_payloads[0]["y"] == 540
    assert gaze_payloads[0]["confidence"] == 0.5

    states = [payload["state"] for topic, payload in capturing_bus.emitted if topic == "calibration/state"]
    assert "ready" in states
