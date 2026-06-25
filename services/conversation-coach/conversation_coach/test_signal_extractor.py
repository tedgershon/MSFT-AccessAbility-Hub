"""Tests for the real perception model (audio VAD + face fusion -> windows).

Hardware-free: audio analysis runs on synthetic PCM bytes, and the face analyzer's
synthetic passthrough lets us drive the default extractor end-to-end with
``FaceObservation`` "frames" (or ``None`` for nobody on camera). The asserted contract
is behavioural: a window of synthetic cues makes ``ConversationCoach`` surface the
matching repair prompt.
"""

from __future__ import annotations

from array import array

from conversation_coach.coaching import ConversationCoach, ConversationSignal
from conversation_coach.perception import (
    EnergyAudioAnalyzer,
    FaceObservation,
    LandmarkFaceAnalyzer,
    WindowedSignalExtractor,
)


def _pcm(amplitude: int, ms: int, sample_rate: int = 16_000) -> bytes:
    """Synthetic mono int16 PCM: a constant level for ``ms`` milliseconds."""
    n = int(sample_rate * ms / 1000)
    return array("h", [amplitude] * n).tobytes()


def _run(extractor: WindowedSignalExtractor, frame, chunk, ticks: int):
    """Feed ``ticks`` identical (frame, chunk) ticks; return the last result."""
    signal = None
    for _ in range(ticks):
        signal = extractor.extract(frame, chunk)
    return signal


# --- EnergyAudioAnalyzer (real, dependency-free) ---------------------------


def test_audio_analyzer_flags_loud_speech_as_voiced() -> None:
    obs = EnergyAudioAnalyzer().observe(_pcm(8000, ms=100))
    assert obs.voiced is True
    assert obs.volume > 0.5
    assert obs.duration_ms == 100.0


def test_audio_analyzer_treats_quiet_chunk_as_silence() -> None:
    obs = EnergyAudioAnalyzer().observe(_pcm(0, ms=100))
    assert obs.voiced is False
    assert obs.volume == 0.0
    assert obs.duration_ms == 100.0


def test_audio_analyzer_reports_idle_tick_for_no_chunk() -> None:
    obs = EnergyAudioAnalyzer(idle_tick_ms=40.0).observe(None)
    assert obs.voiced is False
    assert obs.volume == 0.0
    assert obs.duration_ms == 40.0


# --- LandmarkFaceAnalyzer (synthetic passthrough + pure mapping) -----------


def test_face_analyzer_passes_through_synthetic_observation() -> None:
    analyzer = LandmarkFaceAnalyzer()
    obs = FaceObservation(speaking=True, disengaged=0.3, wants_turn=0.1)
    assert analyzer.observe(obs) is obs


def test_face_analyzer_reports_no_partner_for_empty_frame() -> None:
    assert LandmarkFaceAnalyzer().observe(None) is None


def test_face_features_map_measures_to_observation() -> None:
    analyzer = LandmarkFaceAnalyzer(mouth_open_threshold=0.35)
    speaking = analyzer.features(mouth_open=0.5, gaze_offset=0.8, brow_raise=0.2)
    assert speaking.speaking is True
    assert speaking.disengaged == 0.8
    assert speaking.wants_turn == 0.2

    quiet = analyzer.features(mouth_open=0.1, gaze_offset=2.0, brow_raise=-1.0)
    assert quiet.speaking is False
    assert quiet.disengaged == 1.0  # clamped to 0..1
    assert quiet.wants_turn == 0.0


# --- WindowedSignalExtractor windowing -------------------------------------


def test_extractor_emits_only_once_a_window_has_elapsed() -> None:
    extractor = WindowedSignalExtractor(window_ms=200)
    assert extractor.extract(None, _pcm(8000, ms=100)) is None
    signal = extractor.extract(None, _pcm(8000, ms=100))
    assert isinstance(signal, ConversationSignal)
    assert signal.window_ms == 200


def test_extractor_resets_between_windows() -> None:
    extractor = WindowedSignalExtractor(window_ms=200)
    first = _run(extractor, None, _pcm(8000, ms=100), ticks=2)
    assert first is not None and first.user_speaking_ratio == 1.0
    # A following window of silence must not carry over the previous speech.
    second = _run(extractor, None, _pcm(0, ms=100), ticks=2)
    assert second is not None
    assert second.user_speaking_ratio == 0.0
    assert second.silence_ratio == 1.0


# --- End-to-end: synthetic cues surface the matching prompt ----------------


def _keys_for(frame, chunk) -> set[str]:
    extractor = WindowedSignalExtractor(window_ms=200)
    signal = _run(extractor, frame, chunk, ticks=2)
    assert signal is not None
    return {p.key for p in ConversationCoach().assess(signal)}


def test_monologue_window_surfaces_monologue_prompt() -> None:
    keys = _keys_for(frame=None, chunk=_pcm(8000, ms=100))
    assert "monologue" in keys


def test_awkward_silence_window_surfaces_silence_prompt() -> None:
    keys = _keys_for(frame=None, chunk=_pcm(0, ms=100))
    assert "awkward-silence" in keys


def test_talk_over_window_surfaces_talk_over_prompt() -> None:
    frame = FaceObservation(speaking=True)
    keys = _keys_for(frame=frame, chunk=_pcm(8000, ms=100))
    assert "talk-over" in keys


def test_missed_turn_window_surfaces_missed_turn_prompt() -> None:
    frame = FaceObservation(speaking=False, wants_turn=0.8)
    keys = _keys_for(frame=frame, chunk=_pcm(8000, ms=100))
    assert "missed-turn-cue" in keys


def test_disengagement_window_surfaces_disengagement_prompt() -> None:
    frame = FaceObservation(speaking=False, disengaged=0.8)
    keys = _keys_for(frame=frame, chunk=_pcm(8000, ms=100))
    assert "disengagement" in keys


# --- Graceful degradation with no partner on camera ------------------------


def test_visual_detectors_stand_down_when_partner_off_camera() -> None:
    extractor = WindowedSignalExtractor(window_ms=200)
    signal = _run(extractor, None, _pcm(8000, ms=100), ticks=2)
    assert signal is not None
    assert signal.partner_visible is False
    assert signal.partner_disengaged == 0.0
    assert signal.partner_wants_turn == 0.0

    keys = {p.key for p in ConversationCoach().assess(signal)}
    assert "disengagement" not in keys
    assert "missed-turn-cue" not in keys


def test_partner_visible_requires_majority_of_window() -> None:
    extractor = WindowedSignalExtractor(window_ms=300)
    # Partner appears for only one of three ticks -> not the majority.
    extractor.extract(FaceObservation(speaking=False, disengaged=0.9), _pcm(8000, ms=100))
    extractor.extract(None, _pcm(8000, ms=100))
    signal = extractor.extract(None, _pcm(8000, ms=100))
    assert signal is not None
    assert signal.partner_visible is False
    assert signal.partner_disengaged == 0.0
