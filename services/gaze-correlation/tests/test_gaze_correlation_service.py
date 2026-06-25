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

    states = [
        payload["state"]
        for topic, payload in capturing_bus.emitted
        if topic == "calibration/state"
    ]
    assert "collecting" in states
    assert "idle" in states


def test_calibration_samples_mark_service_ready(capturing_bus) -> None:
    svc = GazeCorrelationService()
    asyncio.run(svc.on_load(make_ctx(capturing_bus)))
    asyncio.run(svc.on_enable())

    svc.add_calibration_sample(camera_x=0.1, camera_y=0.2, screen_x=100, screen_y=200)
    svc.add_calibration_sample(camera_x=0.9, camera_y=0.8, screen_x=1820, screen_y=880)

    states = [
        payload["state"]
        for topic, payload in capturing_bus.emitted
        if topic == "calibration/state"
    ]
    assert "ready" in states


def test_ingesting_gaze_and_display_emits_mapped_point_when_calibrated(capturing_bus) -> None:
    svc = GazeCorrelationService()
    asyncio.run(svc.on_load(make_ctx(capturing_bus)))
    asyncio.run(svc.on_enable())

    svc.add_calibration_sample(camera_x=0.0, camera_y=0.0, screen_x=0, screen_y=0)
    svc.add_calibration_sample(camera_x=1.0, camera_y=1.0, screen_x=1920, screen_y=1080)
    svc.ingest_display_frame_ref(
        {
            "sourceServiceId": "shell-display-capture",
            "capturedAtMs": 2,
            "width": 1920,
            "height": 1080,
        }
    )
    svc.ingest_camera_gaze(
        {
            "sourceServiceId": "eye-tracking",
            "capturedAtMs": 3,
            "x": 0.5,
            "y": 0.25,
            "confidence": 0.8,
        }
    )

    gaze_payloads = [payload for topic, payload in capturing_bus.emitted if topic == "gaze/point"]
    assert len(gaze_payloads) == 1
    assert gaze_payloads[0]["sourceServiceId"] == "gaze-correlation"
    assert gaze_payloads[0]["x"] == 960
    assert gaze_payloads[0]["y"] == 270
    assert gaze_payloads[0]["confidence"] == 0.8


def test_no_gaze_emitted_until_calibrated(capturing_bus) -> None:
    svc = GazeCorrelationService()
    asyncio.run(svc.on_load(make_ctx(capturing_bus)))
    asyncio.run(svc.on_enable())

    svc.ingest_display_frame_ref(
        {
            "sourceServiceId": "shell-display-capture",
            "capturedAtMs": 2,
            "width": 1920,
            "height": 1080,
        }
    )
    svc.ingest_camera_gaze(
        {
            "sourceServiceId": "eye-tracking",
            "capturedAtMs": 3,
            "x": 0.5,
            "y": 0.25,
            "confidence": 0.8,
        }
    )

    gaze_payloads = [payload for topic, payload in capturing_bus.emitted if topic == "gaze/point"]
    assert len(gaze_payloads) == 0


class PubSubBus:
    """Bus stub mirroring the kernel ``on``/``emit`` contract for runtime wiring."""

    def __init__(self) -> None:
        self._handlers: dict[str, list] = {}
        self.emitted: list[tuple[str, object]] = []

    def on(self, topic: str, handler):
        self._handlers.setdefault(topic, []).append(handler)
        return lambda: self._handlers[topic].remove(handler)

    def emit(self, topic: str, payload) -> None:
        self.emitted.append((topic, payload))
        for handler in list(self._handlers.get(topic, [])):
            handler(payload)


def test_bus_subscriptions_drive_ingestion_and_emit_gaze_point() -> None:
    bus = PubSubBus()
    svc = GazeCorrelationService()
    asyncio.run(svc.on_load(make_ctx(bus)))
    asyncio.run(svc.on_enable())

    svc.add_calibration_sample(camera_x=0.0, camera_y=0.0, screen_x=0, screen_y=0)
    svc.add_calibration_sample(camera_x=1.0, camera_y=1.0, screen_x=1920, screen_y=1080)

    # Emitting on the bus (not calling ingest directly) must drive correlation.
    bus.emit(
        "display/frame-ref",
        {
            "sourceServiceId": "shell-display-capture",
            "capturedAtMs": 1,
            "width": 1920,
            "height": 1080,
        },
    )
    svc.ingest_camera_gaze(
        {
            "sourceServiceId": "eye-tracking",
            "capturedAtMs": 2,
            "x": 0.5,
            "y": 0.25,
            "confidence": 0.8,
        }
    )

    gaze_payloads = [payload for topic, payload in bus.emitted if topic == "gaze/point"]
    assert len(gaze_payloads) == 1
    assert gaze_payloads[0]["x"] == 960
    assert gaze_payloads[0]["y"] == 270


def test_on_unload_releases_bus_subscriptions() -> None:
    bus = PubSubBus()
    svc = GazeCorrelationService()
    asyncio.run(svc.on_load(make_ctx(bus)))
    asyncio.run(svc.on_unload())

    # After unload no handlers remain, so emitting is a no-op for the service.
    bus.emit(
        "display/frame-ref",
        {
            "sourceServiceId": "shell-display-capture",
            "capturedAtMs": 1,
            "width": 1920,
            "height": 1080,
        },
    )
    assert all(topic != "gaze/point" for topic, _ in bus.emitted)

