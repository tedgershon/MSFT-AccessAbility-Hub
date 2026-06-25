"""Camera + microphone perception source for the Conversation Coach.

The coach needs *one* fused stream of conversational features. This module hides
the camera/mic behind a small :class:`PerceptionSource` protocol so the service can:

* hold the camera/mic as a single logical lease that is opened in ``on_enable`` and
  **released in ``on_disable``** (contract rule 5), and
* run entirely hardware-free in tests via :class:`ScriptedPerception`.

:class:`AdapterPerception` is the production source: it wraps the shared
``camera-adapter`` and ``audio-adapter`` (capture stays in the adapters, reusable and
tile-agnostic) and fuses each frame + audio chunk into a :class:`ConversationSignal`
via an injectable :class:`SignalExtractor`. The service body never changes regardless
of which source is wired.
"""

from __future__ import annotations

from collections import deque
from typing import Any, Protocol

from audio_adapter import AudioAdapter
from camera_adapter import CameraAdapter

from .coaching import ConversationSignal


class PerceptionSource(Protocol):
    """A leased camera+mic feature stream.

    ``open`` acquires the devices, ``close`` releases them (must be idempotent), and
    ``poll`` returns the next analysed window or ``None`` when none is ready yet.
    """

    @property
    def is_open(self) -> bool: ...

    def open(self) -> None: ...

    def close(self) -> None: ...

    def poll(self) -> ConversationSignal | None: ...


class SignalExtractor(Protocol):
    """Fuses a raw camera frame + audio chunk into a :class:`ConversationSignal`.

    This is the single seam where conversational-feature inference (gaze / turn-taking
    estimation from frames, voice-activity ratios from audio, ...) plugs in. It is
    deliberately injectable so the heavy model work lives behind this protocol and the
    service never changes. Return ``None`` when not enough has accumulated to emit a
    window yet.
    """

    def extract(self, frame: Any, chunk: bytes | None) -> ConversationSignal | None: ...


class NullSignalExtractor:
    """Placeholder extractor that infers nothing (always returns ``None``).

    Keeps the real device path wired and testable while the perception model is built
    separately; drop in a real :class:`SignalExtractor` (no service changes) to make
    the coach start surfacing prompts from live camera + mic.
    """

    def extract(self, frame: Any, chunk: bytes | None) -> ConversationSignal | None:
        _ = (frame, chunk)
        return None


class AdapterPerception:
    """Real camera + microphone perception backed by the hub adapters.

    Holds the camera and mic as one logical lease: :meth:`open` acquires both and
    :meth:`close` releases both (idempotent — contract rule 5). :meth:`poll` reads the
    latest frame + audio chunk and hands them to the injected :class:`SignalExtractor`.
    The adapters own the hardware (and stay reusable by any tile); only the fusion
    lives here.
    """

    def __init__(
        self,
        camera: CameraAdapter | None = None,
        audio: AudioAdapter | None = None,
        extractor: SignalExtractor | None = None,
    ) -> None:
        self._camera = camera or CameraAdapter()
        self._audio = audio or AudioAdapter()
        self._extractor = extractor or NullSignalExtractor()
        self._open = False

    @property
    def is_open(self) -> bool:
        # Reflect real device state so a lease dropped underneath us is observable.
        return self._open and self._camera.is_open and self._audio.is_open

    def open(self) -> None:
        if self._open:
            return
        self._camera.open()
        try:
            self._audio.open_input()
        except Exception:
            # Never leak the camera if the mic fails to come up.
            self._camera.close()
            raise
        self._open = True

    def close(self) -> None:
        # Release both devices; safe to call repeatedly, even after a half-open.
        self._audio.close()
        self._camera.close()
        self._open = False

    def poll(self) -> ConversationSignal | None:
        if not self._open:
            raise RuntimeError("poll() before open()")
        frame = self._camera.read()
        chunk = self._audio.read()
        return self._extractor.extract(frame, chunk)


class ScriptedPerception:
    """Hardware-free source that replays a fixed list of signals.

    Used by tests and by ``--demo`` runs. Tracks open/close so tests can assert the
    lease is released. Reads past the script return ``None`` (stream idle), matching
    the audio adapter's drained-stream behaviour.
    """

    def __init__(self, signals: list[ConversationSignal] | None = None) -> None:
        self._queue: deque[ConversationSignal] = deque(signals or [])
        self._open = False
        self.open_count = 0
        self.close_count = 0

    @property
    def is_open(self) -> bool:
        return self._open

    def open(self) -> None:
        if not self._open:
            self._open = True
            self.open_count += 1

    def close(self) -> None:
        if self._open:
            self._open = False
            self.close_count += 1

    def poll(self) -> ConversationSignal | None:
        if not self._open:
            raise RuntimeError("poll() before open()")
        if not self._queue:
            return None
        return self._queue.popleft()
