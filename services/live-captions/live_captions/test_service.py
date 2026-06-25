"""Unit tests for the Live Captions service (hardware- and model-free).

Covers the service-rule checklist (manifest correctness, mic lease released on
disable, health tracks enabled state) plus the audio->caption pipeline and the two
sub-toggles (translation #23, sound alerts #19) sharing one pipeline + overlay surface.
"""

from __future__ import annotations

import asyncio

from aah_contracts import (
    OVERLAY_ATTACH,
    OVERLAY_DETACH,
    OVERLAY_UPDATE,
    Capability,
    ServiceContext,
)
from audio_adapter import AudioAdapter, FakeAudioBackend

from live_captions import (
    LiveCaptionsService,
    ScriptedSoundRecognizer,
    ScriptedSpeechRecognizer,
    SoundEvent,
    TaggedTranslator,
    Transcript,
)


class CapturingBus:
    """Records emitted (topic, payload) events for assertions."""

    def __init__(self) -> None:
        self.emitted: list[tuple[str, dict]] = []

    def emit(self, topic: str, payload: dict) -> None:
        self.emitted.append((topic, payload))

    def topics(self) -> list[str]:
        return [t for t, _ in self.emitted]

    def payloads(self, topic: str) -> list[dict]:
        return [p for t, p in self.emitted if t == topic]


def _run(coro) -> None:
    asyncio.run(coro)


def _make_service(
    *,
    transcripts=None,
    sound_table=None,
    translator=None,
    config=None,
):
    backend = FakeAudioBackend()
    audio = AudioAdapter(backend=backend)
    recognizer = ScriptedSpeechRecognizer(transcripts or [])
    sound_recognizer = (
        ScriptedSoundRecognizer(sound_table) if sound_table is not None else None
    )
    service = LiveCaptionsService(
        audio=audio,
        recognizer=recognizer,
        translator=translator or TaggedTranslator(),
        sound_recognizer=sound_recognizer,
    )
    bus = CapturingBus()
    ctx = ServiceContext(self_id="live-captions", bus=bus, config=config or {})
    return service, ctx, bus, backend, recognizer


# -- contract rules ---------------------------------------------------------
def test_requires_manifest_declares_mic_and_overlay() -> None:
    service = LiveCaptionsService()
    assert Capability(resource="audioIn", mode="exclusive") in service.requires
    assert Capability(resource="displayOverlay", mode="shared") in service.requires
    # Declares ONLY what it touches: nothing more than mic + overlay.
    assert len(service.requires) == 2


def test_enable_acquires_mic_disable_releases_it() -> None:
    service, ctx, _bus, backend, _rec = _make_service()

    _run(service.on_load(ctx))
    _run(service.on_enable())
    assert backend.open_count == 1
    assert service._audio.is_open is True

    _run(service.on_disable())
    # Mic lease MUST be released in on_disable (rule 6).
    assert backend.closed is True
    assert service._audio.is_open is False


def test_health_tracks_lifecycle_state() -> None:
    service, ctx, _bus, _backend, _rec = _make_service()
    assert service.health_check().state == "degraded"  # not loaded

    _run(service.on_load(ctx))
    assert service.health_check().state == "healthy"
    assert service.health_check().detail == "idle"

    _run(service.on_enable())
    health = service.health_check()
    assert health.state == "healthy"
    assert "captioning" in (health.detail or "")

    _run(service.on_disable())
    assert service.health_check().detail == "idle"


# -- overlay lifecycle ------------------------------------------------------
def test_enable_attaches_caption_layer_disable_detaches_both() -> None:
    service, ctx, bus, _backend, _rec = _make_service()
    _run(service.on_load(ctx))
    _run(service.on_enable())

    attaches = bus.payloads(OVERLAY_ATTACH)
    assert len(attaches) == 1
    assert attaches[0]["id"] == "live-captions:caption"
    assert attaches[0]["ownerId"] == "live-captions"
    assert attaches[0]["kind"] == "live-caption"

    _run(service.on_disable())
    detach_ids = {p["id"] for p in bus.payloads(OVERLAY_DETACH)}
    assert detach_ids == {"live-captions:caption", "live-captions:sound-alert"}


# -- speech -> caption pipeline --------------------------------------------
def test_ingest_emits_caption_update() -> None:
    service, ctx, bus, _backend, _rec = _make_service(
        transcripts=[Transcript(text="hello world")],
    )
    _run(service.on_load(ctx))
    _run(service.on_enable())

    result = service.ingest_audio(b"chunk")
    assert result is not None and result.text == "hello world"

    updates = bus.payloads(OVERLAY_UPDATE)
    assert len(updates) == 1
    params = updates[0]["params"]
    assert params["text"] == "hello world"
    assert params["translated"] is False
    assert updates[0]["id"] == "live-captions:caption"


def test_ingest_is_noop_when_disabled() -> None:
    service, ctx, bus, _backend, _rec = _make_service(
        transcripts=[Transcript(text="ignored")],
    )
    _run(service.on_load(ctx))
    # Not enabled yet.
    assert service.ingest_audio(b"chunk") is None
    assert bus.payloads(OVERLAY_UPDATE) == []


def test_pump_reads_from_adapter_and_captions() -> None:
    service, ctx, bus, backend, _rec = _make_service(
        transcripts=[Transcript(text="from mic")],
    )
    _run(service.on_load(ctx))
    _run(service.on_enable())
    backend.feed(b"audio-block")

    assert service.pump() is True
    assert bus.payloads(OVERLAY_UPDATE)[0]["params"]["text"] == "from mic"
    # Stream idle now -> nothing to process.
    assert service.pump() is False


# -- translation sub-toggle (#23) ------------------------------------------
def test_translation_toggle_translates_caption() -> None:
    service, ctx, bus, _backend, _rec = _make_service(
        transcripts=[Transcript(text="hello")],
        config={"liveCaptions.translate": True, "liveCaptions.translateTo": "es"},
    )
    _run(service.on_load(ctx))
    _run(service.on_enable())

    service.ingest_audio(b"chunk")
    params = bus.payloads(OVERLAY_UPDATE)[0]["params"]
    assert params["text"] == "[es] hello"
    assert params["translated"] is True
    assert params["sourceText"] == "hello"
    assert params["language"] == "es"


def test_translation_can_be_toggled_at_runtime() -> None:
    service, ctx, bus, _backend, _rec = _make_service(
        transcripts=[Transcript(text="one"), Transcript(text="two")],
    )
    _run(service.on_load(ctx))
    _run(service.on_enable())

    service.ingest_audio(b"a")  # translation off
    service.set_translation(True, target="fr")
    service.ingest_audio(b"b")  # translation on

    updates = bus.payloads(OVERLAY_UPDATE)
    assert updates[0]["params"]["text"] == "one"
    assert updates[1]["params"]["text"] == "[fr] two"


# -- sound-alert sub-toggle (#19) ------------------------------------------
def test_sound_alerts_emit_alert_layer() -> None:
    service, ctx, bus, _backend, _rec = _make_service(
        transcripts=[None],
        sound_table={b"ring": SoundEvent(label="doorbell", confidence=0.9)},
        config={"liveCaptions.soundAlerts": True},
    )
    _run(service.on_load(ctx))
    _run(service.on_enable())

    service.ingest_audio(b"ring")
    alerts = [p for p in bus.payloads(OVERLAY_UPDATE) if p["kind"] == "sound-alert"]
    assert len(alerts) == 1
    assert alerts[0]["id"] == "live-captions:sound-alert"
    assert alerts[0]["params"] == {"label": "doorbell", "confidence": 0.9}


def test_sound_alerts_off_by_default() -> None:
    service, ctx, bus, _backend, _rec = _make_service(
        transcripts=[None],
        sound_table={b"ring": SoundEvent(label="doorbell")},
    )
    _run(service.on_load(ctx))
    _run(service.on_enable())

    service.ingest_audio(b"ring")
    assert [p for p in bus.payloads(OVERLAY_UPDATE) if p["kind"] == "sound-alert"] == []


def test_disabling_sound_alerts_detaches_alert_layer() -> None:
    service, ctx, bus, _backend, _rec = _make_service(
        config={"liveCaptions.soundAlerts": True},
    )
    _run(service.on_load(ctx))
    _run(service.on_enable())

    service.set_sound_alerts(False)
    assert any(
        p["id"] == "live-captions:sound-alert" for p in bus.payloads(OVERLAY_DETACH)
    )
