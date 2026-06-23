"""Shared pytest fixtures for the Python side.

Supports writing service tests; contains no tests itself. Mirrors the intent of the
TS ``@aah/test-fixtures`` package: a configurable fake service + a capturing bus stub.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest
from aah_contracts import (
    AccessibilityService,
    Capability,
    HealthStatus,
    ServiceContext,
    ServiceMeta,
    healthy,
)


@dataclass
class LifecycleLog:
    calls: list[str] = field(default_factory=list)


class FakeService(AccessibilityService):
    """Instrumented service for tests; records lifecycle calls."""

    def __init__(
        self,
        log: LifecycleLog,
        service_id: str = "fake",
        requires: list[Capability] | None = None,
    ) -> None:
        self.meta = ServiceMeta(id=service_id, name="Fake", version="0.0.0")
        self.requires = requires or []
        self._log = log

    async def on_load(self, ctx: ServiceContext) -> None:
        self._log.calls.append(f"{self.meta.id}:on_load")

    async def on_enable(self) -> None:
        self._log.calls.append(f"{self.meta.id}:on_enable")

    async def on_disable(self) -> None:
        self._log.calls.append(f"{self.meta.id}:on_disable")

    async def on_unload(self) -> None:
        self._log.calls.append(f"{self.meta.id}:on_unload")

    def health_check(self) -> HealthStatus:
        return healthy()


class CapturingBus:
    """Records emitted events for assertions."""

    def __init__(self) -> None:
        self.emitted: list[tuple[str, Any]] = []

    def emit(self, topic: str, payload: Any) -> None:
        self.emitted.append((topic, payload))


@pytest.fixture
def lifecycle_log() -> LifecycleLog:
    return LifecycleLog()


@pytest.fixture
def capturing_bus() -> CapturingBus:
    return CapturingBus()


def pytest_sessionfinish(session, exitstatus: int) -> None:
    """Don't fail CI while the suite is still empty.

    During scaffolding there are no test files yet. Mirror vitest's
    ``passWithNoTests`` so a clean run with nothing collected is a success
    instead of pytest's exit code 5. Harmless once real tests exist.
    """
    if exitstatus == 5:  # pytest.ExitCode.NO_TESTS_COLLECTED
        session.exitstatus = 0

