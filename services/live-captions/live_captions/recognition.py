"""Recognition seam for the Live Captions pipeline.

The audio -> caption pipeline is built from three narrow, swappable interfaces so the
service stays hardware- and model-free in tests (the heavy Whisper / Vosk / audio
classifier dependencies are imported lazily inside the real backends only):

* :class:`SpeechRecognizer` — PCM audio chunk -> :class:`Transcript` (speech-to-text).
* :class:`Translator` — caption text -> translated text (the translation sub-toggle).
* :class:`SoundRecognizer` — PCM audio chunk -> :class:`SoundEvent` for non-speech
  cues such as a doorbell or alarm (the sound-alert sub-toggle).

Each interface ships a deterministic, dependency-free fake used by the unit tests and
a real backend (``pragma: no cover``) that imports its optional dependency lazily, so
this module imports cleanly on a machine with neither a microphone nor the models.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from audio_adapter import AudioChunk


# ---------------------------------------------------------------------------
# Value types
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Transcript:
    """One recognized utterance (or partial)."""

    text: str
    is_final: bool = True
    confidence: float = 1.0


@dataclass(frozen=True, slots=True)
class SoundEvent:
    """A recognized non-speech sound (e.g. ``doorbell``, ``alarm``)."""

    label: str
    confidence: float = 1.0


# ---------------------------------------------------------------------------
# Interfaces
# ---------------------------------------------------------------------------
@runtime_checkable
class SpeechRecognizer(Protocol):
    """Streaming speech-to-text over PCM audio chunks."""

    def accept(self, chunk: AudioChunk) -> Transcript | None:
        """Feed one audio block; return a :class:`Transcript` when text is ready."""
        ...

    def reset(self) -> None:
        """Drop any buffered/partial state (called on enable)."""
        ...


@runtime_checkable
class Translator(Protocol):
    """Translates caption text into a target language."""

    def translate(self, text: str, *, target: str) -> str: ...


@runtime_checkable
class SoundRecognizer(Protocol):
    """Classifies non-speech sounds from PCM audio chunks."""

    def classify(self, chunk: AudioChunk) -> SoundEvent | None:
        """Return a :class:`SoundEvent` when a non-speech sound is detected."""
        ...


# ---------------------------------------------------------------------------
# Deterministic, dependency-free fakes (used by tests and as safe defaults)
# ---------------------------------------------------------------------------
class ScriptedSpeechRecognizer:
    """Yields queued transcripts in order, one per :meth:`accept` that has audio.

    A ``None`` entry models a chunk that produced no text yet (still buffering).
    """

    def __init__(self, transcripts: list[Transcript | None] | None = None) -> None:
        self._queued: list[Transcript | None] = list(transcripts or [])
        self.reset_count = 0

    def feed(self, transcript: Transcript | None) -> None:
        self._queued.append(transcript)

    def accept(self, chunk: AudioChunk) -> Transcript | None:
        if self._queued:
            return self._queued.pop(0)
        return None

    def reset(self) -> None:
        self.reset_count += 1


class IdentityTranslator:
    """Pass-through translator: returns the text unchanged (no-op default)."""

    def translate(self, text: str, *, target: str) -> str:
        return text


class TaggedTranslator:
    """Deterministic fake translator: prefixes the target tag for assertable output."""

    def translate(self, text: str, *, target: str) -> str:
        return f"[{target}] {text}"


class ScriptedSoundRecognizer:
    """Classifies chunks via an exact ``bytes -> SoundEvent`` lookup table."""

    def __init__(self, table: dict[AudioChunk, SoundEvent] | None = None) -> None:
        self._table: dict[AudioChunk, SoundEvent] = dict(table or {})

    def register(self, chunk: AudioChunk, event: SoundEvent) -> None:
        self._table[chunk] = event

    def classify(self, chunk: AudioChunk) -> SoundEvent | None:
        return self._table.get(chunk)


# ---------------------------------------------------------------------------
# Real backends (optional deps imported lazily; excluded from coverage)
# ---------------------------------------------------------------------------
class WhisperSpeechRecognizer:  # pragma: no cover - requires the whisper model
    """Speech-to-text backed by ``faster-whisper``.

    The model is imported and loaded lazily on first :meth:`accept` so importing this
    module never requires the optional dependency or downloading weights.
    """

    def __init__(self, model_size: str = "base", language: str = "en") -> None:
        self._model_size = model_size
        self._language = language
        self._model: object | None = None

    def _ensure_model(self) -> object:
        if self._model is None:
            try:
                from faster_whisper import WhisperModel  # type: ignore[import-not-found]
            except Exception as exc:
                raise RuntimeError(
                    "faster-whisper is not installed; install the optional speech "
                    "backend or inject a SpeechRecognizer explicitly."
                ) from exc
            self._model = WhisperModel(self._model_size)
        return self._model

    def accept(self, chunk: AudioChunk) -> Transcript | None:
        model = self._ensure_model()
        segments, _info = model.transcribe(chunk, language=self._language)  # type: ignore[attr-defined]
        text = " ".join(seg.text.strip() for seg in segments).strip()
        if not text:
            return None
        return Transcript(text=text)

    def reset(self) -> None:
        return None


__all__ = [
    "AudioChunk",
    "Transcript",
    "SoundEvent",
    "SpeechRecognizer",
    "Translator",
    "SoundRecognizer",
    "ScriptedSpeechRecognizer",
    "IdentityTranslator",
    "TaggedTranslator",
    "ScriptedSoundRecognizer",
    "WhisperSpeechRecognizer",
]
