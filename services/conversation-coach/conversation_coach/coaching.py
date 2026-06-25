"""Pure conversation-coaching analysis core (no I/O, no hardware).

Mirrors the Strategy pattern used by ``colorblind-contrast``: the service stays a
thin lifecycle shell while the decision logic lives here as a set of independent,
unit-testable *cue detectors*. Each detector inspects a :class:`ConversationSignal`
— a snapshot of camera- and audio-derived features for a short window — and may
emit a :class:`RepairPrompt`. ``ConversationCoach`` runs them all and de-duplicates.

This module imports nothing outside the standard library so it can be tested
hardware-free and reused regardless of how the raw signal is produced.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class ConversationSignal:
    """Features for one short analysis window of a call.

    All ratios are 0..1. Camera-derived fields degrade gracefully: when the partner
    is off-camera, ``partner_visible`` is ``False`` and the visual detectors stand
    down rather than guessing.
    """

    # Audio-derived.
    user_speaking_ratio: float = 0.0  # share of the window the user spoke.
    silence_ratio: float = 0.0  # share of the window with nobody speaking.
    overlap_ratio: float = 0.0  # share where user + partner spoke at once.
    user_volume: float = 0.5  # 0..1 relative loudness of the user.

    # Camera-derived.
    partner_visible: bool = True
    partner_disengaged: float = 0.0  # 0..1 averted gaze / lean-away estimate.
    partner_wants_turn: float = 0.0  # 0..1 raised-hand / inhale-to-speak estimate.

    window_ms: int = 5000


@dataclass(frozen=True, slots=True)
class RepairPrompt:
    """A private, self-directed nudge surfaced only to the user.

    ``key`` is a stable identity used to de-duplicate and to throttle repeats;
    ``severity`` lets the overlay style gentle hints differently from urgent ones.
    """

    key: str
    text: str
    severity: str = "hint"  # "hint" | "warn"


class CueDetector(Protocol):
    """One conversational failure mode. Returns a prompt or ``None``."""

    key: str

    def inspect(self, signal: ConversationSignal) -> RepairPrompt | None: ...


@dataclass(frozen=True, slots=True)
class MonologueDetector:
    """User has dominated the window — suggest yielding the floor."""

    key: str = "monologue"
    threshold: float = 0.85

    def inspect(self, signal: ConversationSignal) -> RepairPrompt | None:
        if signal.user_speaking_ratio >= self.threshold:
            return RepairPrompt(
                self.key,
                "You've been speaking a while — try pausing to invite a response.",
                "hint",
            )
        return None


@dataclass(frozen=True, slots=True)
class TalkOverDetector:
    """User and partner are overlapping — suggest yielding immediately."""

    key: str = "talk-over"
    threshold: float = 0.2

    def inspect(self, signal: ConversationSignal) -> RepairPrompt | None:
        if signal.overlap_ratio >= self.threshold:
            return RepairPrompt(
                self.key,
                "You may be talking over them — pause and let them finish.",
                "warn",
            )
        return None


@dataclass(frozen=True, slots=True)
class MissedTurnCueDetector:
    """Partner is signalling they want to speak but the user keeps going."""

    key: str = "missed-turn-cue"
    want_threshold: float = 0.6
    speaking_threshold: float = 0.5

    def inspect(self, signal: ConversationSignal) -> RepairPrompt | None:
        if not signal.partner_visible:
            return None
        if (
            signal.partner_wants_turn >= self.want_threshold
            and signal.user_speaking_ratio >= self.speaking_threshold
        ):
            return RepairPrompt(
                self.key,
                "They look ready to speak — consider handing over the turn.",
                "warn",
            )
        return None


@dataclass(frozen=True, slots=True)
class AwkwardSilenceDetector:
    """A long shared silence — suggest a question to re-open the exchange."""

    key: str = "awkward-silence"
    threshold: float = 0.7

    def inspect(self, signal: ConversationSignal) -> RepairPrompt | None:
        if signal.silence_ratio >= self.threshold:
            return RepairPrompt(
                self.key,
                "Long pause — you could ask an open question to continue.",
                "hint",
            )
        return None


@dataclass(frozen=True, slots=True)
class DisengagementDetector:
    """Partner looks disengaged while the user is talking — suggest checking in."""

    key: str = "disengagement"
    threshold: float = 0.6
    speaking_threshold: float = 0.4

    def inspect(self, signal: ConversationSignal) -> RepairPrompt | None:
        if not signal.partner_visible:
            return None
        if (
            signal.partner_disengaged >= self.threshold
            and signal.user_speaking_ratio >= self.speaking_threshold
        ):
            return RepairPrompt(
                self.key,
                "They seem to be drifting — try checking in or asking what they think.",
                "hint",
            )
        return None


def default_detectors() -> list[CueDetector]:
    """The standard detector set, ordered most- to least-urgent."""

    return [
        TalkOverDetector(),
        MissedTurnCueDetector(),
        DisengagementDetector(),
        MonologueDetector(),
        AwkwardSilenceDetector(),
    ]


class ConversationCoach:
    """Runs the detectors over a signal and yields prompts to surface.

    Stateful only for throttling: a prompt with a given ``key`` is not re-surfaced
    until it has stopped firing for ``cooldown_windows`` consecutive windows, so the
    user isn't nagged every tick about the same ongoing situation.
    """

    def __init__(
        self,
        detectors: list[CueDetector] | None = None,
        cooldown_windows: int = 2,
    ) -> None:
        self._detectors = detectors if detectors is not None else default_detectors()
        self._cooldown = max(0, cooldown_windows)
        # key -> windows remaining before it may fire again.
        self._muted: dict[str, int] = {}

    def assess(self, signal: ConversationSignal) -> list[RepairPrompt]:
        """Return the prompts to surface for this window (throttled)."""

        # Age out existing mutes by one window.
        self._muted = {k: v - 1 for k, v in self._muted.items() if v - 1 > 0}

        out: list[RepairPrompt] = []
        for detector in self._detectors:
            prompt = detector.inspect(signal)
            if prompt is None:
                continue
            if prompt.key in self._muted:
                continue
            out.append(prompt)
            self._muted[prompt.key] = self._cooldown + 1
        return out

    def reset(self) -> None:
        """Clear throttle state (e.g. between calls)."""

        self._muted.clear()
