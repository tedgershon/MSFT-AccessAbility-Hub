"""The service contract (Python mirror of service.ts).

Python-side services implement :class:`AccessibilityService`. The lifecycle and
``requires`` manifest are identical in shape to the TS contract so the kernel can
treat every service uniformly across the IPC seam.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from .capability import Capability
from .health import HealthStatus


@dataclass(frozen=True, slots=True)
class ServiceMeta:
    id: str
    name: str
    version: str


@dataclass(slots=True)
class ServiceContext:
    """Dependencies injected by the kernel host process over IPC.

    ``bus`` is a thin client to the kernel Event Bus; ``config`` is a key/value view.
    A service must never reach for another service — only the bus and config.
    """

    self_id: str
    bus: Any  # IPC bus client; typed concretely by the Python host runtime.
    config: dict[str, Any]


class AccessibilityService(ABC):
    """Lifecycle interface implemented by every Python service.

    Order: on_load -> on_enable -> (running) -> on_disable -> on_unload.
    Camera/mic leases MUST be released in ``on_disable``.
    """

    meta: ServiceMeta
    requires: list[Capability]

    @abstractmethod
    async def on_load(self, ctx: ServiceContext) -> None: ...

    @abstractmethod
    async def on_enable(self) -> None: ...

    @abstractmethod
    async def on_disable(self) -> None: ...

    @abstractmethod
    async def on_unload(self) -> None: ...

    @abstractmethod
    def health_check(self) -> HealthStatus: ...
