"""Live Captions service (Python) — the "Live Captions" hub tile.

Captures mic audio -> speech-to-text -> caption overlay, with translation and
non-speech sound alerts as sub-toggles sharing one audio->caption pipeline and one
overlay surface. Runs in its own process and talks to the kernel only across the IPC
seam (event bus) — never via direct calls. Depends only on aah_contracts (+ the audio
adapter and IPC host).
"""

from __future__ import annotations

from .recognition import (
    IdentityTranslator,
    ScriptedSoundRecognizer,
    ScriptedSpeechRecognizer,
    SoundEvent,
    SoundRecognizer,
    SpeechRecognizer,
    TaggedTranslator,
    Transcript,
    Translator,
    WhisperSpeechRecognizer,
)
from .service import LiveCaptionsService

__all__ = [
    "LiveCaptionsService",
    "Transcript",
    "SoundEvent",
    "SpeechRecognizer",
    "Translator",
    "SoundRecognizer",
    "ScriptedSpeechRecognizer",
    "ScriptedSoundRecognizer",
    "IdentityTranslator",
    "TaggedTranslator",
    "WhisperSpeechRecognizer",
]
