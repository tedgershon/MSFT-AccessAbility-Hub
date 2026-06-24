"""Voice-commands service tests (deterministic, hardware-free).

Exercises the full mic -> ASR -> bus seam with a fake audio backend and a fake
recognizer. Asserts the hard rule: the mic lease is released in ``on_disable``.
"""

from __future__ import annotations

import asyncio

from aah_contracts import ServiceContext
from audio_adapter import AudioAdapter, FakeAudioBackend
from voice_commands import VoiceCommandsService
from voice_commands.recognizer import FakeRecognizer


class CapturingBus:
    """Records emitted events for assertions (mirrors the IPC bus client surface)."""

    def __init__(self) -> None:
        self.emitted: list[tuple[str, object]] = []

    def emit(self, topic: str, payload: object) -> None:
        self.emitted.append((topic, payload))


def _context(bus: CapturingBus) -> ServiceContext:
    return ServiceContext(self_id="voice-commands", bus=bus, config={})


def _service(
    *, chunks: list[bytes] | None = None, vocabulary: set[str] | None = None
) -> tuple[VoiceCommandsService, FakeAudioBackend, CapturingBus]:
    backend = FakeAudioBackend(chunks=chunks)
    adapter = AudioAdapter(backend=backend)
    service = VoiceCommandsService(
        audio=adapter,
        recognizer=FakeRecognizer(vocabulary=vocabulary),
        auto_listen=False,
    )
    return service, backend, CapturingBus()


def test_enable_acquires_mic_disable_releases_it() -> None:
    service, backend, bus = _service()

    async def scenario() -> None:
        await service.on_load(_context(bus))
        await service.on_enable()
        assert backend.opened is True  # mic lease acquired
        await service.on_disable()

    asyncio.run(scenario())

    assert backend.opened is False  # mic lease RELEASED in on_disable (rule 5)
    assert backend.close_count == 1


def test_recognized_command_emits_input_intent() -> None:
    service, _backend, bus = _service(chunks=[b"scroll down"])

    async def scenario() -> int:
        await service.on_load(_context(bus))
        await service.on_enable()
        return service.pump()

    processed = asyncio.run(scenario())

    assert processed == 1
    assert len(bus.emitted) == 1
    topic, payload = bus.emitted[0]
    assert topic == "input/intent"
    assert payload == {
        "source": "voice-commands",
        "kind": "keyboard",
        "payload": {"command": "scroll down", "transcript": "scroll down"},
    }


def test_unrecognized_audio_emits_nothing() -> None:
    # Empty chunk -> no command; vocabulary filters out unknown phrases.
    service, _backend, bus = _service(chunks=[b"", b"unknown phrase"], vocabulary={"go back"})

    async def scenario() -> int:
        await service.on_load(_context(bus))
        await service.on_enable()
        return service.pump()

    processed = asyncio.run(scenario())

    assert processed == 2
    assert bus.emitted == []


def test_health_check_transitions() -> None:
    service, _backend, bus = _service()
    states: list[tuple[str, str | None]] = []

    async def scenario() -> None:
        await service.on_load(_context(bus))
        idle = service.health_check()
        states.append((idle.state, idle.detail))
        await service.on_enable()
        listening = service.health_check()
        states.append((listening.state, listening.detail))
        await service.on_disable()
        after = service.health_check()
        states.append((after.state, after.detail))

    asyncio.run(scenario())

    assert states[0] == ("healthy", "idle")
    assert states[1][0] == "healthy"
    assert states[1][1] is not None and states[1][1].startswith("listening")
    assert states[2] == ("healthy", "idle")


def test_background_listener_starts_and_stops() -> None:
    backend = FakeAudioBackend()
    service = VoiceCommandsService(
        audio=AudioAdapter(backend=backend),
        recognizer=FakeRecognizer(),
        auto_listen=True,
        poll_interval=0.001,
    )
    bus = CapturingBus()

    async def scenario() -> None:
        await service.on_load(_context(bus))
        await service.on_enable()
        assert service._task is not None  # noqa: SLF001 - asserting pipeline state
        await asyncio.sleep(0.005)  # let the loop spin at least once
        await service.on_disable()
        assert service._task is None  # noqa: SLF001

    asyncio.run(scenario())

    assert backend.opened is False  # lease released even with the loop running
