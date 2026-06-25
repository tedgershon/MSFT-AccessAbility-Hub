"""Tests for the adapter-backed perception source.

Hardware-free: the camera/audio adapters run on their fake backends, so this
exercises the real lease acquisition + frame/chunk fusion path without a device.
"""

from __future__ import annotations

import pytest
from audio_adapter import AudioAdapter, FakeAudioBackend
from camera_adapter import CameraAdapter, FakeCameraBackend

from conversation_coach.coaching import ConversationSignal
from conversation_coach.perception import AdapterPerception, NullSignalExtractor


class _StubExtractor:
    """Fuses (frame, chunk) into a signal; records what it was handed."""

    def __init__(self) -> None:
        self.seen: list[tuple[object, object]] = []

    def extract(self, frame, chunk):
        self.seen.append((frame, chunk))
        if frame is None and chunk is None:
            return None
        return ConversationSignal(user_speaking_ratio=0.95)


def _perception(camera_frames=None, audio_chunks=None, extractor=None):
    camera = CameraAdapter(backend=FakeCameraBackend(camera_frames))
    audio = AudioAdapter(backend=FakeAudioBackend(audio_chunks))
    return AdapterPerception(camera=camera, audio=audio, extractor=extractor or _StubExtractor())


def test_open_acquires_both_leases_and_close_releases_them() -> None:
    cam_backend = FakeCameraBackend()
    aud_backend = FakeAudioBackend()
    perception = AdapterPerception(
        camera=CameraAdapter(backend=cam_backend),
        audio=AudioAdapter(backend=aud_backend),
    )

    perception.open()
    assert perception.is_open is True
    assert cam_backend.open_count == 1
    assert aud_backend.open_count == 1

    perception.close()
    assert perception.is_open is False
    assert cam_backend.close_count == 1
    assert aud_backend.close_count == 1


def test_close_is_idempotent() -> None:
    perception = _perception()
    perception.open()
    perception.close()
    perception.close()  # must not raise or double-release in a way that errors
    assert perception.is_open is False


def test_poll_before_open_raises() -> None:
    perception = _perception()
    with pytest.raises(RuntimeError):
        perception.poll()


def test_poll_fuses_frame_and_chunk_via_extractor() -> None:
    extractor = _StubExtractor()
    perception = _perception(
        camera_frames=["frame-0"],
        audio_chunks=[b"chunk-0"],
        extractor=extractor,
    )
    perception.open()

    signal = perception.poll()
    assert isinstance(signal, ConversationSignal)
    assert signal.user_speaking_ratio == 0.95
    assert extractor.seen == [("frame-0", b"chunk-0")]


def test_poll_returns_none_when_devices_idle() -> None:
    # No queued frames/chunks: both adapters return None, extractor yields no window.
    perception = _perception()
    perception.open()
    assert perception.poll() is None


def test_null_extractor_infers_nothing() -> None:
    perception = _perception(
        camera_frames=["frame-0"],
        audio_chunks=[b"chunk-0"],
        extractor=NullSignalExtractor(),
    )
    perception.open()
    assert perception.poll() is None


def test_is_open_reflects_device_release() -> None:
    camera = CameraAdapter(backend=FakeCameraBackend())
    perception = AdapterPerception(camera=camera, audio=AudioAdapter(backend=FakeAudioBackend()))
    perception.open()
    assert perception.is_open is True

    # If a device lease is released underneath the source, is_open reflects it so the
    # service's health_check can report the loss (-> unhealthy -> supervisor restart).
    camera.close()
    assert perception.is_open is False


def test_mic_failure_on_open_releases_camera() -> None:
    cam_backend = FakeCameraBackend()

    class _FailingAudio:
        is_open = False

        def open_input(self) -> None:
            raise RuntimeError("no mic")

        def close(self) -> None:  # pragma: no cover - not reached in this path
            pass

        def read(self):  # pragma: no cover - not reached in this path
            return None

    perception = AdapterPerception(camera=CameraAdapter(backend=cam_backend), audio=_FailingAudio())
    with pytest.raises(RuntimeError):
        perception.open()

    # Camera must not be left acquired when the mic fails to come up.
    assert cam_backend.close_count == 1
    assert perception.is_open is False
