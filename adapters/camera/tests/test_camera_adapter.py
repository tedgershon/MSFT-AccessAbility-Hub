"""Camera adapter tests (hardware-free via FakeCameraBackend)."""

from __future__ import annotations

import pytest
from camera_adapter import CameraAdapter, FakeCameraBackend


def test_open_read_close_cycle() -> None:
    backend = FakeCameraBackend(frames=["f1", "f2"])
    adapter = CameraAdapter(backend=backend)

    assert adapter.is_open is False

    adapter.open()
    assert adapter.is_open is True
    assert backend.opened is True
    assert backend.open_count == 1

    assert adapter.read() == "f1"
    assert adapter.read() == "f2"
    assert adapter.read() is None


def test_close_releases_device() -> None:
    backend = FakeCameraBackend()
    adapter = CameraAdapter(backend=backend)
    adapter.open()

    adapter.close()

    assert adapter.is_open is False
    assert backend.closed is True
    assert backend.opened is False
    assert backend.close_count == 1


def test_read_before_open_raises() -> None:
    adapter = CameraAdapter(backend=FakeCameraBackend())
    with pytest.raises(RuntimeError):
        adapter.read()


def test_close_is_idempotent() -> None:
    backend = FakeCameraBackend()
    adapter = CameraAdapter(backend=backend)
    adapter.open()

    adapter.close()
    adapter.close()

    assert adapter.is_open is False
    assert backend.close_count == 1
