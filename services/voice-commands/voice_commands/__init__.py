"""Voice command service (Python).

Whisper / Vosk speech libs are Python-native. Runs in its own process. Declares
``audioIn: exclusive`` and ``commandChannel: shared``; the mic lease MUST be
released in ``on_disable`` (contract rule 5).
"""

from __future__ import annotations

from aah_contracts import (
    AccessibilityService,
    Capability,
    HealthStatus,
    ServiceContext,
    ServiceMeta,
    healthy,
)


class VoiceCommandsService(AccessibilityService):
    meta = ServiceMeta(id="voice-commands", name="Voice Commands", version="0.1.0")
    requires = [
        Capability(resource="audioIn", mode="exclusive"),
        Capability(resource="commandChannel", mode="shared"),
    ]

    def __init__(self) -> None:
        self._ctx: ServiceContext | None = None
        self._active = False

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx

    async def on_enable(self) -> None:
        # TODO: open the mic + start the ASR pipeline.
        self._active = True

    async def on_disable(self) -> None:
        # TODO: stop ASR and RELEASE the mic (rule 5).
        self._active = False

    async def on_unload(self) -> None:
        self._ctx = None

    def health_check(self) -> HealthStatus:
        return healthy("listening" if self._active else "idle")
