"""Unit tests for gaze dwell intent emission."""

from __future__ import annotations

import asyncio

from aah_contracts import ServiceContext
from gaze_dwell import DwellConfig, GazeDwellService


class PubSubBus:
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


def make_ctx(bus) -> ServiceContext:
    return ServiceContext(self_id="gaze-dwell", bus=bus, config={})


def gaze(x: float, y: float, captured_at_ms: int, confidence: float = 0.9) -> dict:
    return {
        "sourceServiceId": "gaze-correlation",
        "capturedAtMs": captured_at_ms,
        "x": x,
        "y": y,
        "confidence": confidence,
    }


def test_stable_gaze_emits_single_click_intent() -> None:
    bus = PubSubBus()
    svc = GazeDwellService(DwellConfig(dwell_ms=500, radius_px=25, min_confidence=0.5))
    asyncio.run(svc.on_load(make_ctx(bus)))
    asyncio.run(svc.on_enable())

    bus.emit("gaze/point", gaze(100, 100, 1_000))
    bus.emit("gaze/point", gaze(110, 108, 1_300))
    bus.emit("gaze/point", gaze(105, 101, 1_600))
    bus.emit("gaze/point", gaze(104, 100, 1_900))

    intents = [payload for topic, payload in bus.emitted if topic == "input/intent"]
    contexts = [payload for topic, payload in bus.emitted if topic == "input/context"]
    assert len(intents) == 1
    assert len(contexts) == 1
    assert intents[0]["source"] == "gaze-dwell"
    assert intents[0]["kind"] == "cursor"
    assert intents[0]["payload"]["action"] == "leftClick"
    assert contexts[0]["context"]["hints"]["selection"] == "dwell"


def test_low_confidence_resets_dwell_anchor() -> None:
    bus = PubSubBus()
    svc = GazeDwellService(DwellConfig(dwell_ms=500, radius_px=25, min_confidence=0.5))
    asyncio.run(svc.on_load(make_ctx(bus)))
    asyncio.run(svc.on_enable())

    bus.emit("gaze/point", gaze(100, 100, 1_000))
    bus.emit("gaze/point", gaze(102, 102, 1_600, confidence=0.1))
    bus.emit("gaze/point", gaze(101, 101, 1_700))

    intents = [payload for topic, payload in bus.emitted if topic == "input/intent"]
    assert intents == []
