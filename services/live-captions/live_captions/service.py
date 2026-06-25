"""Live Captions service (Python) — the "Live Captions" hub tile (epic #30).

Captures microphone audio, runs it through speech-to-text, and renders the result as
a caption layer on the shared overlay surface. Two sub-toggles ride the *same*
audio -> caption pipeline and the *same* overlay surface (per the epic):

* **Translation** (#23): when on, each caption is translated before it is rendered.
* **Sound alerts** (#19): when on, non-speech sounds (doorbell, alarm, ...) are
  recognized from the same audio and surfaced as a transient visual alert layer.

Contract compliance:

* Depends only on ``aah_contracts`` + the injected bus (rule 1). Audio capture goes
  through the ``audio-adapter`` (an adapter, not another service).
* Declares ``audioIn: exclusive`` (the mic) and ``displayOverlay: shared`` (rule 2),
  and the mic lease acquired in :meth:`on_enable` is released in :meth:`on_disable`
  (rule 6). It never drives input.
* Overlay events are emitted as plain JSON-serializable dicts with camelCase keys so
  they cross the TS/Python IPC seam unchanged (rule 4).

The recognition models are injected (see :mod:`live_captions.recognition`), so the
service is fully testable without a microphone or any ML dependency. The blocking
capture loop lives in the host runtime; tests (and that loop) drive one block at a
time through :meth:`ingest_audio` / :meth:`pump`.
"""

from __future__ import annotations

from typing import Any

# Overlay render topics (mirror of the TS EventMap). Imported as constants so the wire
# topic matches the host process exactly.
from aah_contracts import (
    OVERLAY_ATTACH,
    OVERLAY_DETACH,
    OVERLAY_UPDATE,
    AccessibilityService,
    Capability,
    HealthStatus,
    ServiceContext,
    ServiceMeta,
    degraded,
    healthy,
)
from audio_adapter import AudioAdapter, AudioChunk

from .recognition import (
    IdentityTranslator,
    SoundEvent,
    SoundRecognizer,
    SpeechRecognizer,
    Transcript,
    Translator,
    WhisperSpeechRecognizer,
)


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _as_str(value: Any, default: str) -> str:
    return value if isinstance(value, str) and value else default


class LiveCaptionsService(AccessibilityService):
    meta = ServiceMeta(id="live-captions", name="Live Captions", version="0.1.0")

    # The mic is held exclusively; the overlay surface is shared with other tiles.
    requires = [
        Capability(resource="audioIn", mode="exclusive"),
        Capability(resource="displayOverlay", mode="shared"),
    ]

    def __init__(
        self,
        *,
        audio: AudioAdapter | None = None,
        recognizer: SpeechRecognizer | None = None,
        translator: Translator | None = None,
        sound_recognizer: SoundRecognizer | None = None,
    ) -> None:
        # Injectable seams (real backends are the lazy defaults); tests pass fakes.
        self._audio = audio if audio is not None else AudioAdapter()
        self._recognizer: SpeechRecognizer = (
            recognizer if recognizer is not None else WhisperSpeechRecognizer()
        )
        self._translator: Translator = (
            translator if translator is not None else IdentityTranslator()
        )
        self._sound_recognizer = sound_recognizer

        self._ctx: ServiceContext | None = None
        self._active = False

        # Sub-toggle state (seeded from config in on_load).
        self._language = "en"
        self._translate = False
        self._translate_to = "en"
        self._sound_alerts = False

        # Last rendered caption + simple counters for health/diagnostics.
        self._last_caption = ""
        self._caption_count = 0
        self._alert_count = 0

    # -- lifecycle ----------------------------------------------------------
    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx
        cfg = ctx.config
        self._language = _as_str(cfg.get("liveCaptions.language"), "en")
        self._translate = _as_bool(cfg.get("liveCaptions.translate"), False)
        self._translate_to = _as_str(cfg.get("liveCaptions.translateTo"), "en")
        self._sound_alerts = _as_bool(cfg.get("liveCaptions.soundAlerts"), False)

    async def on_enable(self) -> None:
        ctx = self._ctx
        if ctx is None:
            return
        self._recognizer.reset()
        self._last_caption = ""
        self._caption_count = 0
        self._alert_count = 0
        # Acquire the mic (the exclusive audioIn lease).
        self._audio.open_input()
        self._active = True
        # Mount the (initially empty) caption layer on the shared overlay surface.
        ctx.bus.emit(
            OVERLAY_ATTACH,
            {
                "id": self._caption_layer_id,
                "ownerId": ctx.self_id,
                "kind": "caption",
                "params": {"text": "", "language": self._caption_language},
            },
        )

    async def on_disable(self) -> None:
        ctx = self._ctx
        if ctx is None or not self._active:
            return
        self._active = False
        # Take both layers off the shared surface...
        ctx.bus.emit(
            OVERLAY_DETACH,
            {"id": self._caption_layer_id, "ownerId": ctx.self_id},
        )
        ctx.bus.emit(
            OVERLAY_DETACH,
            {"id": self._alert_layer_id, "ownerId": ctx.self_id},
        )
        # ...then RELEASE the mic lease (rule 6).
        self._audio.close()

    async def on_unload(self) -> None:
        self._ctx = None

    # -- sub-toggles (flippable while enabled; share the one pipeline) -------
    def set_translation(self, enabled: bool, *, target: str | None = None) -> None:
        """Toggle the translation sub-feature (#23). ``target`` sets the language."""
        self._translate = enabled
        if target:
            self._translate_to = target

    def set_sound_alerts(self, enabled: bool) -> None:
        """Toggle the non-speech sound-alert sub-feature (#19)."""
        self._sound_alerts = enabled
        ctx = self._ctx
        # Clear any lingering alert layer when the toggle is switched off.
        if not enabled and self._active and ctx is not None:
            ctx.bus.emit(
                OVERLAY_DETACH,
                {"id": self._alert_layer_id, "ownerId": ctx.self_id},
            )

    # -- pipeline -----------------------------------------------------------
    def pump(self) -> bool:
        """Read one audio block from the mic and process it.

        Returns ``True`` if a block was available and processed, ``False`` when the
        capture stream is idle. Intended to be called repeatedly by the host loop.
        """
        if not self._active:
            return False
        chunk = self._audio.read()
        if chunk is None:
            return False
        self.ingest_audio(chunk)
        return True

    def ingest_audio(self, chunk: AudioChunk) -> Transcript | None:
        """Run one audio block through the shared pipeline.

        Speech -> (optional translation) -> caption layer; and, when the sound-alert
        sub-toggle is on, non-speech sound -> transient alert layer. No-op until the
        service is enabled. Returns the recognized :class:`Transcript`, if any.
        """
        ctx = self._ctx
        if not self._active or ctx is None:
            return None

        if self._sound_alerts and self._sound_recognizer is not None:
            event = self._sound_recognizer.classify(chunk)
            if event is not None:
                self._emit_sound_alert(ctx, event)

        transcript = self._recognizer.accept(chunk)
        if transcript is None or not transcript.text.strip():
            return transcript

        rendered = transcript.text
        translated = False
        if self._translate:
            rendered = self._translator.translate(rendered, target=self._translate_to)
            translated = True

        self._last_caption = rendered
        self._caption_count += 1
        ctx.bus.emit(
            OVERLAY_UPDATE,
            {
                "id": self._caption_layer_id,
                "ownerId": ctx.self_id,
                "kind": "caption",
                "params": {
                    "text": rendered,
                    "language": self._caption_language,
                    "isFinal": transcript.is_final,
                    "confidence": transcript.confidence,
                    "translated": translated,
                    "sourceText": transcript.text if translated else None,
                },
            },
        )
        return transcript

    def _emit_sound_alert(self, ctx: ServiceContext, event: SoundEvent) -> None:
        self._alert_count += 1
        ctx.bus.emit(
            OVERLAY_UPDATE,
            {
                "id": self._alert_layer_id,
                "ownerId": ctx.self_id,
                "kind": "sound-alert",
                "params": {"label": event.label, "confidence": event.confidence},
            },
        )

    # -- health -------------------------------------------------------------
    def health_check(self) -> HealthStatus:
        if self._ctx is None:
            return degraded("not loaded")
        if not self._active:
            return healthy("idle")
        if not self._audio.is_open:
            # Enabled but the mic lease is gone — the supervisor should restart us.
            return degraded("mic lease lost")
        flags = []
        if self._translate:
            flags.append(f"translate->{self._translate_to}")
        if self._sound_alerts:
            flags.append("sound-alerts")
        suffix = f" [{', '.join(flags)}]" if flags else ""
        return healthy(f"captioning ({self._caption_count} captions){suffix}")

    # -- internals ----------------------------------------------------------
    @property
    def _caption_language(self) -> str:
        return self._translate_to if self._translate else self._language

    @property
    def _caption_layer_id(self) -> str:
        return f"{self.meta.id}:caption"

    @property
    def _alert_layer_id(self) -> str:
        return f"{self.meta.id}:sound-alert"
