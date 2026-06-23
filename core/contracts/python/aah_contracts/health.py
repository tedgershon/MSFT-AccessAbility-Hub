"""Health reporting types (Python mirror of health.ts)."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

HealthState = Literal["healthy", "degraded", "unhealthy"]


@dataclass(frozen=True, slots=True)
class HealthStatus:
    state: HealthState
    checked_at: int
    detail: str | None = None


def _now_ms() -> int:
    return int(time.time() * 1000)


def healthy(detail: str | None = None) -> HealthStatus:
    return HealthStatus(state="healthy", detail=detail, checked_at=_now_ms())


def degraded(detail: str) -> HealthStatus:
    return HealthStatus(state="degraded", detail=detail, checked_at=_now_ms())


def unhealthy(detail: str) -> HealthStatus:
    return HealthStatus(state="unhealthy", detail=detail, checked_at=_now_ms())
