"""Python mirror of the AccessAbility Hub shared contracts.

These types mirror ``core/contracts/src`` (TS) and are generated from the same
JSON Schema in the full build. Python-side services depend on this package and talk
to the kernel exclusively across the event-bus / IPC seam — never via direct calls.
"""

from .capability import AccessMode, Capability, Resource
from .health import HealthState, HealthStatus, degraded, healthy, unhealthy
from .service import AccessibilityService, ServiceContext, ServiceMeta

__all__ = [
    "AccessMode",
    "Capability",
    "Resource",
    "HealthState",
    "HealthStatus",
    "degraded",
    "healthy",
    "unhealthy",
    "AccessibilityService",
    "ServiceContext",
    "ServiceMeta",
]
