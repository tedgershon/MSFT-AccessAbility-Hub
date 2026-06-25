"""Gaze dwell service.

Consumes screen-space ``gaze/point`` events and emits ``input/intent`` only after
the gaze remains stable long enough. This keeps eye tracking as a provider and
routes all resulting cursor actions through the hub input multiplexer.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from aah_contracts import (
    AccessibilityService,
    Capability,
    HealthStatus,
    ServiceContext,
    ServiceMeta,
    healthy,
)


@dataclass(frozen=True, slots=True)
class DwellConfig:
    dwell_ms: int = 700
    radius_px: float = 48.0
    min_confidence: float = 0.55


class GazeDwellService(AccessibilityService):
    meta = ServiceMeta(id="gaze-dwell", name="Gaze Dwell", version="0.1.0")
    requires = [
        Capability(resource="cursor", mode="shared"),
    ]

    def __init__(self, config: DwellConfig | None = None) -> None:
        self._ctx: ServiceContext | None = None
        self._config = config or DwellConfig()
        self._active = False
        self._anchor: dict[str, Any] | None = None
        self._fired_for_anchor = False
        self._unsubscribes: list[Callable[[], None]] = []

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx
        service_config = ctx.config
        self._config = DwellConfig(
            dwell_ms=int(service_config.get("gazeDwellMs", self._config.dwell_ms)),
            radius_px=float(service_config.get("gazeDwellRadiusPx", self._config.radius_px)),
            min_confidence=float(
                service_config.get("gazeDwellMinConfidence", self._config.min_confidence)
            ),
        )
        subscribe = getattr(ctx.bus, "on", None)
        if callable(subscribe):
            self._unsubscribes.append(subscribe("gaze/point", self.ingest_gaze_point))

    async def on_enable(self) -> None:
        self._active = True

    async def on_disable(self) -> None:
        self._active = False
        self._anchor = None
        self._fired_for_anchor = False

    async def on_unload(self) -> None:
        for unsubscribe in self._unsubscribes:
            unsubscribe()
        self._unsubscribes.clear()
        self._ctx = None

    def health_check(self) -> HealthStatus:
        return healthy("dwelling" if self._active else "idle")

    def ingest_gaze_point(self, gaze: dict[str, Any]) -> None:
        if not self._active or self._ctx is None:
            return
        if float(gaze.get("confidence", 0.0)) < self._config.min_confidence:
            self._reset_anchor()
            return

        if self._anchor is None or not self._within_radius(gaze, self._anchor):
            self._anchor = gaze
            self._fired_for_anchor = False
            return

        elapsed_ms = int(gaze["capturedAtMs"]) - int(self._anchor["capturedAtMs"])
        if elapsed_ms >= self._config.dwell_ms and not self._fired_for_anchor:
            self._emit_click_intent(gaze, elapsed_ms)
            self._fired_for_anchor = True

    def _within_radius(self, gaze: dict[str, Any], anchor: dict[str, Any]) -> bool:
        dx = float(gaze["x"]) - float(anchor["x"])
        dy = float(gaze["y"]) - float(anchor["y"])
        return ((dx * dx) + (dy * dy)) ** 0.5 <= self._config.radius_px

    def _emit_click_intent(self, gaze: dict[str, Any], elapsed_ms: int) -> None:
        payload = {
            "action": "leftClick",
            "x": float(gaze["x"]),
            "y": float(gaze["y"]),
            "dwellMs": elapsed_ms,
        }
        event = {
            "source": self.meta.id,
            "kind": "cursor",
            "payload": payload,
        }
        self._ctx.bus.emit("input/intent", event)
        self._ctx.bus.emit(
            "input/context",
            {
                **event,
                "context": {
                    "gaze": gaze,
                    "hints": {"selection": "dwell"},
                },
            },
        )

    def _reset_anchor(self) -> None:
        self._anchor = None
        self._fired_for_anchor = False
