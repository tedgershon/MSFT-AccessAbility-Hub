"""Unit tests for the pure conversation-coaching analysis core."""

from __future__ import annotations

from conversation_coach.coaching import (
    AwkwardSilenceDetector,
    ConversationCoach,
    ConversationSignal,
    DisengagementDetector,
    MissedTurnCueDetector,
    MonologueDetector,
    TalkOverDetector,
    default_detectors,
)


def test_monologue_detector_fires_above_threshold() -> None:
    assert MonologueDetector().inspect(ConversationSignal(user_speaking_ratio=0.9)) is not None
    assert MonologueDetector().inspect(ConversationSignal(user_speaking_ratio=0.5)) is None


def test_talk_over_detector_is_a_warning() -> None:
    prompt = TalkOverDetector().inspect(ConversationSignal(overlap_ratio=0.3))
    assert prompt is not None
    assert prompt.severity == "warn"


def test_visual_detectors_stand_down_when_partner_not_visible() -> None:
    signal = ConversationSignal(
        partner_visible=False,
        partner_wants_turn=1.0,
        partner_disengaged=1.0,
        user_speaking_ratio=1.0,
    )
    assert MissedTurnCueDetector().inspect(signal) is None
    assert DisengagementDetector().inspect(signal) is None


def test_missed_turn_cue_requires_user_still_speaking() -> None:
    talking = ConversationSignal(partner_wants_turn=0.8, user_speaking_ratio=0.8)
    quiet = ConversationSignal(partner_wants_turn=0.8, user_speaking_ratio=0.1)
    assert MissedTurnCueDetector().inspect(talking) is not None
    assert MissedTurnCueDetector().inspect(quiet) is None


def test_awkward_silence_detector() -> None:
    assert AwkwardSilenceDetector().inspect(ConversationSignal(silence_ratio=0.8)) is not None
    assert AwkwardSilenceDetector().inspect(ConversationSignal(silence_ratio=0.2)) is None


def test_coach_assess_returns_all_matching_prompts() -> None:
    coach = ConversationCoach()
    signal = ConversationSignal(user_speaking_ratio=0.9, overlap_ratio=0.3)
    keys = {p.key for p in coach.assess(signal)}
    assert "monologue" in keys
    assert "talk-over" in keys


def test_coach_assess_quiet_signal_is_silent() -> None:
    coach = ConversationCoach()
    assert coach.assess(ConversationSignal()) == []


def test_coach_throttles_repeat_prompts() -> None:
    coach = ConversationCoach(cooldown_windows=2)
    monologue = ConversationSignal(user_speaking_ratio=0.9)

    # First window surfaces it; the next two are muted.
    assert [p.key for p in coach.assess(monologue)] == ["monologue"]
    assert coach.assess(monologue) == []
    assert coach.assess(monologue) == []
    # Cooldown elapsed -> it may fire again.
    assert [p.key for p in coach.assess(monologue)] == ["monologue"]


def test_coach_reset_clears_throttle() -> None:
    coach = ConversationCoach(cooldown_windows=5)
    monologue = ConversationSignal(user_speaking_ratio=0.9)
    assert coach.assess(monologue)
    assert coach.assess(monologue) == []
    coach.reset()
    assert coach.assess(monologue)


def test_default_detector_keys_are_unique() -> None:
    keys = [d.key for d in default_detectors()]
    assert len(keys) == len(set(keys))
