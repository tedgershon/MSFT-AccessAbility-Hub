"""Voice command service (Python).

Whisper / Vosk speech libs are Python-native. Runs in its own process. Declares
``audioIn: exclusive`` and ``commandChannel: shared``; the mic lease MUST be
released in ``on_disable`` (contract rule 5).

Pipeline: the :class:`~audio_adapter.AudioAdapter` captures mic audio, a pluggable
:class:`~voice_commands.recognizer.Recognizer` turns each block into command text,
and recognized commands are published as ``input/intent`` events on the kernel bus
(the TS<->Python seam). The audio adapter is a hardware wrapper, not a service, so
depending on it does not breach the "contracts + bus only" rule.
"""

from __future__ import annotations

import asyncio

from aah_contracts import (
    AccessibilityService,
    Capability,
    HealthStatus,
    ServiceContext,
    ServiceMeta,
    healthy,
    unhealthy,
)
from audio_adapter import AudioAdapter

from .recognizer import FakeRecognizer, Recognizer


class VoiceCommandsService(AccessibilityService):
    meta = ServiceMeta(id="voice-commands", name="Voice Commands", version="0.1.0")
    requires = [
        Capability(resource="audioIn", mode="exclusive"),
        Capability(resource="commandChannel", mode="shared"),
    ]

    def __init__(
        self,
        *,
        audio: AudioAdapter | None = None,
        recognizer: Recognizer | None = None,
        auto_listen: bool = True,
        poll_interval: float = 0.01,
    ) -> None:
        self._ctx: ServiceContext | None = None
        self._audio = audio
        self._recognizer: Recognizer = recognizer or FakeRecognizer()
        self._auto_listen = auto_listen
        self._poll_interval = poll_interval
        self._active = False
        self._task: asyncio.Task[None] | None = None
        self._recognized = 0

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx

    async def on_enable(self) -> None:
        # Acquire the exclusive mic lease, then start the ASR pipeline.
        if self._ctx is None:
            raise RuntimeError("on_enable called before on_load")
        if self._audio is None:
            self._audio = AudioAdapter()
        self._audio.open_input()
        self._active = True
        self._recognized = 0
        if self._auto_listen:
            self._task = asyncio.create_task(self._listen())

    async def on_disable(self) -> None:
        # Stop ASR and RELEASE the mic lease here (contract rule 5).
        self._active = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._audio is not None:
            self._audio.close()

    async def on_unload(self) -> None:
        self._ctx = None
        self._audio = None

    def pump(self) -> int:
        """Drain all currently-available audio, emitting an intent per command.

        Returns the number of chunks processed. This is the single recognition step
        the background listener loops over; tests drive it directly for determinism.
        """
        if not self._active or self._audio is None:
            return 0
        processed = 0
        while True:
            chunk = self._audio.read()
            if chunk is None:
                break
            self._process_chunk(chunk)
            processed += 1
        return processed

    def _process_chunk(self, chunk: bytes) -> None:
        text = self._recognizer.transcribe(chunk)
        if not text:
            return
        assert self._ctx is not None
        # Publish across the bus/IPC seam — never a direct cross-language call.
        self._ctx.bus.emit(
            "input/intent",
            {
                "source": self.meta.id,
                "kind": "keyboard",
                "payload": {"command": text, "transcript": text},
            },
        )
        self._recognized += 1

    async def _listen(self) -> None:
        while self._active:
            self.pump()
            await asyncio.sleep(self._poll_interval)

    def health_check(self) -> HealthStatus:
        if not self._active:
            return healthy("idle")
        if self._audio is None or not self._audio.is_open:
            return unhealthy("microphone unavailable")
        return healthy(f"listening ({self._recognized} commands recognized)")
