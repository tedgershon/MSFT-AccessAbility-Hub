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

import math
from array import array
from collections import deque
from dataclasses import dataclass
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


# ---------------------------------------------------------------------------
# Real perception model: per-tick audio + face inference fused over a window.
#
# The hub feeds the extractor one (frame, chunk) per poll. A single short tick
# is too noisy to coach on, so :class:`WindowedSignalExtractor` accumulates ticks
# until ``window_ms`` of audio has elapsed and then emits one averaged
# :class:`ConversationSignal`. The two inference steps plug in behind small
# protocols so the heavy/optional model code is isolated and unit-testable:
#
#   * audio -> who is speaking + how loudly (real, dependency-free RMS VAD on the
#     local mic = the *user* channel).
#   * camera -> the *partner*: visible? mouth moving (speaking)? gaze averted
#     (disengaged)? leaning/brow-raise to take a turn (wants_turn)?
#
# Fusing the two gives turn-taking features no single sensor can: silence is
# "neither speaking", overlap is "both speaking". When no face is in frame the
# visual features degrade to "partner not visible" and the visual cue detectors
# stand down rather than guessing.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class AudioObservation:
    """Per-tick audio inference: is the user speaking, and how loudly."""

    voiced: bool
    volume: float  # 0..1 relative loudness.
    duration_ms: float  # wall-clock this chunk represents.


class AudioAnalyzer(Protocol):
    """Turns one raw audio chunk into an :class:`AudioObservation`."""

    def observe(self, chunk: bytes | None) -> AudioObservation: ...


class EnergyAudioAnalyzer:
    """Voice-activity + loudness from a mono PCM chunk (the user's mic).

    Dependency-free and fully real: computes RMS energy over signed 16-bit PCM
    samples, flags the tick as *voiced* above ``voice_rms_threshold`` and maps the
    energy to a 0..1 ``volume``. An empty / ``None`` chunk (mic idle this tick) is
    reported as a silent tick of ``idle_tick_ms`` so the window clock still advances.
    Defaults match the ``audio-adapter`` (16 kHz, int16 mono).
    """

    def __init__(
        self,
        *,
        sample_rate: int = 16_000,
        sample_width: int = 2,
        voice_rms_threshold: float = 500.0,
        volume_full_scale: float = 12_000.0,
        idle_tick_ms: float = 100.0,
    ) -> None:
        self._sample_rate = sample_rate
        self._sample_width = sample_width
        self._voice_rms_threshold = voice_rms_threshold
        self._volume_full_scale = volume_full_scale
        self._idle_tick_ms = idle_tick_ms

    def observe(self, chunk: bytes | None) -> AudioObservation:
        if not chunk:
            return AudioObservation(voiced=False, volume=0.0, duration_ms=self._idle_tick_ms)

        # Drop a trailing odd byte rather than letting ``array`` raise on it.
        usable = len(chunk) - (len(chunk) % self._sample_width)
        samples = array("h")
        samples.frombytes(chunk[:usable])
        if not samples:
            return AudioObservation(voiced=False, volume=0.0, duration_ms=self._idle_tick_ms)

        rms = math.sqrt(sum(s * s for s in samples) / len(samples))
        duration_ms = len(samples) / self._sample_rate * 1000.0
        return AudioObservation(
            voiced=rms >= self._voice_rms_threshold,
            volume=min(1.0, rms / self._volume_full_scale),
            duration_ms=duration_ms,
        )


@dataclass(frozen=True, slots=True)
class FaceObservation:
    """Per-tick camera inference about the conversation *partner*.

    Returned only when a partner face is present; ``None`` from the analyzer means
    nobody is on camera and the visual detectors should stand down.
    """

    speaking: bool  # mouth moving this tick.
    disengaged: float = 0.0  # 0..1 averted-gaze / lean-away estimate.
    wants_turn: float = 0.0  # 0..1 brow-raise / inhale-to-speak estimate.


class FaceAnalyzer(Protocol):
    """Turns one camera frame into a :class:`FaceObservation`, or ``None``."""

    def observe(self, frame: Any) -> FaceObservation | None: ...


class LandmarkFaceAnalyzer:
    """Partner face/gaze inference from a camera frame.

    The pure mapping from three normalised facial measurements to a
    :class:`FaceObservation` lives in :meth:`features` and is unit-tested with
    synthetic values. Extracting those measurements from a real frame requires a
    landmark model (MediaPipe Face Landmarker), imported lazily and guarded so this
    module loads with no CV dependency and tests stay hardware-free.

    For tests and ``--demo`` runs a synthetic frame may be a :class:`FaceObservation`
    (or ``None``), which is passed straight through — so the default extractor can be
    driven end-to-end with synthetic frames and never needs a camera.
    """

    def __init__(
        self,
        *,
        mouth_open_threshold: float = 0.35,
        landmarker: Any | None = None,
    ) -> None:
        self._mouth_open_threshold = mouth_open_threshold
        self._landmarker = landmarker

    def observe(self, frame: Any) -> FaceObservation | None:
        if frame is None:
            return None
        # Synthetic passthrough: tests/demo hand us the observation directly.
        if isinstance(frame, FaceObservation):
            return frame
        measures = self._measure(frame)
        if measures is None:
            return None  # No face detected -> partner not visible.
        mouth_open, gaze_offset, brow_raise = measures
        return self.features(mouth_open, gaze_offset, brow_raise)

    def features(self, mouth_open: float, gaze_offset: float, brow_raise: float) -> FaceObservation:
        """Map normalised mouth/gaze/brow measures to a :class:`FaceObservation`."""

        return FaceObservation(
            speaking=mouth_open >= self._mouth_open_threshold,
            disengaged=_clamp01(gaze_offset),
            wants_turn=_clamp01(brow_raise),
        )

    def _measure(self, frame: Any) -> tuple[float, float, float] | None:  # pragma: no cover
        """Return ``(mouth_open, gaze_offset, brow_raise)`` for the largest face.

        Requires a landmark model + a real frame, so it is excluded from coverage.

        Uses MediaPipe Face Landmarker on a real frame: mouth aspect ratio for
        speaking, iris offset from the eye centre for averted gaze, and brow-to-eye
        distance for a turn-taking bid. Lazily imported and ``None`` when no face is
        found, so the partner simply reads as not-visible.
        """

        landmarker = self._landmarker
        if landmarker is None:
            try:
                import mediapipe as mp  # type: ignore[import-not-found]
            except Exception as exc:
                raise RuntimeError(
                    "mediapipe is not installed; install it or inject a FaceAnalyzer "
                    "explicitly to run the conversation coach against a real camera."
                ) from exc
            landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(
                mp.tasks.vision.FaceLandmarkerOptions(
                    base_options=mp.tasks.BaseOptions(),
                    num_faces=1,
                )
            )
            self._landmarker = landmarker

        import mediapipe as mp  # type: ignore[import-not-found]

        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame)
        result = landmarker.detect(image)
        faces = getattr(result, "face_landmarks", None)
        if not faces:
            return None
        lm = faces[0]

        def _y(i: int) -> float:
            return lm[i].y

        def _x(i: int) -> float:
            return lm[i].x

        # MediaPipe Face Mesh canonical indices.
        mouth_h = abs(_y(13) - _y(14))  # inner upper/lower lip gap.
        mouth_w = abs(_x(61) - _x(291)) or 1e-6  # mouth corners.
        mouth_open = mouth_h / mouth_w

        # Iris (468) vs the eye corners (33 outer, 133 inner): centred gaze ~ 0.5.
        eye_l, eye_r = _x(33), _x(133)
        span = abs(eye_r - eye_l) or 1e-6
        gaze_offset = abs((_x(468) - eye_l) / span - 0.5) * 2.0

        # Brow (105) raised away from the eye (159) signals a bid to speak.
        brow_raise = max(0.0, (_y(159) - _y(105)) * 6.0)

        return mouth_open, gaze_offset, brow_raise


def _clamp01(value: float) -> float:
    return 0.0 if value < 0.0 else 1.0 if value > 1.0 else value


class WindowedSignalExtractor:
    """Real :class:`SignalExtractor`: fuse per-tick audio + face into windows.

    Accumulates each tick's audio (user channel) and face (partner) inference,
    weighted by the tick's duration, and emits one averaged
    :class:`ConversationSignal` once ``window_ms`` of audio has elapsed — then resets
    for the next window. Returns ``None`` for ticks that don't yet complete a window,
    matching the :class:`SignalExtractor` contract.

    Turn-taking features come from fusing the two sources: ``user_speaking_ratio`` and
    ``user_volume`` from the mic; ``silence_ratio`` is the share where neither party
    spoke; ``overlap_ratio`` the share where both did. Visual features average only
    over the time a partner was actually on camera, and ``partner_visible`` reports the
    majority of the window — so with no partner present the visual detectors stand down.
    """

    def __init__(
        self,
        *,
        audio: AudioAnalyzer | None = None,
        face: FaceAnalyzer | None = None,
        window_ms: int = 5000,
    ) -> None:
        self._audio = audio or EnergyAudioAnalyzer()
        self._face = face or LandmarkFaceAnalyzer()
        self._window_ms = window_ms
        self._reset()

    def _reset(self) -> None:
        self._elapsed_ms = 0.0
        self._user_ms = 0.0
        self._partner_ms = 0.0
        self._silence_ms = 0.0
        self._overlap_ms = 0.0
        self._volume_ms = 0.0  # volume integrated over time.
        self._visible_ms = 0.0
        self._disengaged_ms = 0.0  # disengagement integrated over visible time.
        self._wants_turn_ms = 0.0  # wants-turn integrated over visible time.

    def extract(self, frame: Any, chunk: bytes | None) -> ConversationSignal | None:
        audio = self._audio.observe(chunk)
        face = self._face.observe(frame)
        dur = audio.duration_ms

        self._elapsed_ms += dur
        self._volume_ms += audio.volume * dur

        user_speaking = audio.voiced
        if user_speaking:
            self._user_ms += dur

        partner_speaking = face is not None and face.speaking
        if face is not None:
            self._visible_ms += dur
            self._disengaged_ms += face.disengaged * dur
            self._wants_turn_ms += face.wants_turn * dur
            if partner_speaking:
                self._partner_ms += dur

        if user_speaking and partner_speaking:
            self._overlap_ms += dur
        elif not user_speaking and not partner_speaking:
            self._silence_ms += dur

        if self._elapsed_ms < self._window_ms:
            return None
        return self._emit()

    def _emit(self) -> ConversationSignal:
        total = self._elapsed_ms or 1.0
        visible = self._visible_ms or 0.0
        partner_visible = visible > total / 2.0
        if visible > 0.0:
            partner_disengaged = self._disengaged_ms / visible
            partner_wants_turn = self._wants_turn_ms / visible
        else:
            partner_disengaged = 0.0
            partner_wants_turn = 0.0

        signal = ConversationSignal(
            user_speaking_ratio=_clamp01(self._user_ms / total),
            silence_ratio=_clamp01(self._silence_ms / total),
            overlap_ratio=_clamp01(self._overlap_ms / total),
            user_volume=_clamp01(self._volume_ms / total),
            partner_visible=partner_visible,
            partner_disengaged=_clamp01(partner_disengaged) if partner_visible else 0.0,
            partner_wants_turn=_clamp01(partner_wants_turn) if partner_visible else 0.0,
            window_ms=int(self._elapsed_ms),
        )
        self._reset()
        return signal


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
