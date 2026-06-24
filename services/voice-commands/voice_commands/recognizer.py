"""Speech recognizer abstraction for the voice-commands service.

The ASR engine is pluggable behind :class:`Recognizer` so the service depends on a
narrow interface rather than a heavy model. Tests use the deterministic
:class:`FakeRecognizer`; a real Whisper-backed recognizer is provided as an optional,
guarded backend.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class Recognizer(Protocol):
    """Turns a block of audio into recognized command text (or ``None``)."""

    def transcribe(self, chunk: bytes) -> str | None:
        """Return the recognized command for ``chunk``, or ``None`` if none."""
        ...


class FakeRecognizer:
    """Deterministic, model-free recognizer for tests.

    Treats each audio chunk as UTF-8 encoded text. If a ``vocabulary`` is supplied,
    only phrases in that set are recognized; otherwise any non-empty text passes.
    """

    def __init__(self, vocabulary: set[str] | None = None) -> None:
        self._vocabulary = {v.strip().lower() for v in vocabulary} if vocabulary else None

    def transcribe(self, chunk: bytes) -> str | None:
        try:
            text = chunk.decode("utf-8").strip().lower()
        except (UnicodeDecodeError, AttributeError):
            return None
        if not text:
            return None
        if self._vocabulary is not None and text not in self._vocabulary:
            return None
        return text


class WhisperRecognizer:  # pragma: no cover - requires the optional model dependency
    """Real recognizer backed by ``faster-whisper``.

    The model dependency is imported lazily so importing this module never pulls in
    a heavy model. Construct only when real speech recognition is wanted.
    """

    def __init__(self, model_size: str = "base", sample_rate: int = 16_000) -> None:
        try:
            from faster_whisper import WhisperModel  # type: ignore[import-not-found]
        except Exception as exc:
            raise RuntimeError(
                "faster-whisper is not installed; install the optional ASR backend "
                "or inject a Recognizer explicitly."
            ) from exc
        self._model = WhisperModel(model_size)
        self._sample_rate = sample_rate

    def transcribe(self, chunk: bytes) -> str | None:
        import numpy as np  # type: ignore[import-not-found]

        samples = np.frombuffer(chunk, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _info = self._model.transcribe(samples, language="en")
        text = " ".join(segment.text for segment in segments).strip().lower()
        return text or None
