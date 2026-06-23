"""Camera adapter.

Wraps camera capture (OpenCV) behind a narrow interface so vision services never
touch the hardware API directly (Adapter pattern). Acquiring a handle corresponds
to an ``exclusive`` camera lease; releasing it MUST happen on service disable.
"""

from __future__ import annotations

from typing import Any, Protocol


class Frame(Protocol):
    """Opaque captured frame (e.g. a numpy ndarray in the real implementation)."""


class CameraAdapter:
    def __init__(self, device_index: int = 0) -> None:
        self._device_index = device_index
        self._open = False

    def open(self) -> None:
        # TODO: cv2.VideoCapture(self._device_index)
        self._open = True

    def read(self) -> Any:
        # TODO: return the next frame.
        return None

    def close(self) -> None:
        # TODO: release the capture device.
        self._open = False

    @property
    def is_open(self) -> bool:
        return self._open
