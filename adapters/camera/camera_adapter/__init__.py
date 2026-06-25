"""Camera adapter.

Wraps camera capture (OpenCV) behind a narrow interface so vision services never
touch the hardware API directly (Adapter pattern). Acquiring a handle corresponds
to an ``exclusive`` camera lease; releasing it MUST happen on service disable.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


class Frame(Protocol):
    """Opaque captured frame (e.g. a numpy ndarray in the real implementation)."""


@runtime_checkable
class CameraBackend(Protocol):
    """Minimal camera device surface shared by real and fake backends."""

    def open(self, device_index: int = 0) -> None:
        """Acquire/start the camera device."""
        ...

    def read_frame(self) -> Any:
        """Return the next frame, or ``None`` when none is available yet."""
        ...

    def close(self) -> None:
        """Release/stop the camera device."""
        ...


class FakeCameraBackend:
    """Deterministic, hardware-free backend for tests."""

    def __init__(self, frames: list[Any] | None = None) -> None:
        self._queued: list[Any] = list(frames or [])
        self.opened = False
        self.closed = False
        self.open_count = 0
        self.close_count = 0

    def feed(self, frame: Any) -> None:
        self._queued.append(frame)

    def open(self, device_index: int = 0) -> None:
        _ = device_index
        self.opened = True
        self.closed = False
        self.open_count += 1

    def read_frame(self) -> Any:
        if not self.opened:
            raise RuntimeError("camera backend is not open")
        if self._queued:
            return self._queued.pop(0)
        return None

    def close(self) -> None:
        self.opened = False
        self.closed = True
        self.close_count += 1


class OpenCVBackend:  # pragma: no cover - requires real camera hardware
    """Real camera backend backed by ``cv2.VideoCapture``."""

    def __init__(self) -> None:
        self._capture: Any | None = None

    def open(self, device_index: int = 0) -> None:
        try:
            import cv2  # type: ignore[import-not-found]
        except Exception as exc:
            raise RuntimeError(
                "opencv-python is not installed; install it or inject a "
                "CameraBackend explicitly."
            ) from exc

        capture = cv2.VideoCapture(device_index)
        if not capture.isOpened():
            capture.release()
            raise RuntimeError(f"unable to open camera device index {device_index}")
        self._capture = capture

    def read_frame(self) -> Any:
        if self._capture is None:
            raise RuntimeError("camera backend is not open")
        ok, frame = self._capture.read()
        if not ok:
            return None
        return frame

    def close(self) -> None:
        if self._capture is not None:
            self._capture.release()
            self._capture = None


class CameraAdapter:
    def __init__(self, device_index: int = 0, *, backend: CameraBackend | None = None) -> None:
        self._device_index = device_index
        self._backend = backend
        self._open = False

    def _ensure_backend(self) -> CameraBackend:
        if self._backend is None:
            self._backend = OpenCVBackend()
        return self._backend

    def open(self) -> None:
        backend = self._ensure_backend()
        backend.open(self._device_index)
        self._open = True

    def read(self) -> Any:
        if not self._open or self._backend is None:
            raise RuntimeError("camera input is not open; call open() first")
        return self._backend.read_frame()

    def close(self) -> None:
        if self._backend is not None and self._open:
            self._backend.close()
        self._open = False

    @property
    def is_open(self) -> bool:
        return self._open
