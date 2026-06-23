"""Audio adapter.

Wraps microphone capture / speaker playback behind a narrow interface so audio
services never touch the device API directly (Adapter pattern). Acquiring the mic
corresponds to an ``exclusive`` audioIn lease; releasing it MUST happen on disable.
"""

from __future__ import annotations

from typing import Any


class AudioAdapter:
    def __init__(self, device_index: int = 0) -> None:
        self._device_index = device_index
        self._open = False

    def open_input(self) -> None:
        # TODO: open the microphone stream.
        self._open = True

    def read(self) -> Any:
        # TODO: return the next audio chunk.
        return None

    def close(self) -> None:
        # TODO: release the audio device.
        self._open = False

    @property
    def is_open(self) -> bool:
        return self._open
