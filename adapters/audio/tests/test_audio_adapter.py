"""Audio adapter tests (hardware-free via FakeAudioBackend)."""

from __future__ import annotations

import pytest
from audio_adapter import AudioAdapter, FakeAudioBackend


def test_open_read_close_cycle() -> None:
    backend = FakeAudioBackend(chunks=[b"one", b"two"])
    adapter = AudioAdapter(backend=backend)

    assert adapter.is_open is False

    adapter.open_input()
    assert adapter.is_open is True
    assert backend.opened is True
    assert backend.open_count == 1

    assert adapter.read() == b"one"
    assert adapter.read() == b"two"
    # Stream idle -> None once drained.
    assert adapter.read() is None


def test_close_releases_device() -> None:
    backend = FakeAudioBackend()
    adapter = AudioAdapter(backend=backend)
    adapter.open_input()

    adapter.close()

    assert adapter.is_open is False
    assert backend.closed is True
    assert backend.opened is False
    assert backend.close_count == 1


def test_read_before_open_raises() -> None:
    adapter = AudioAdapter(backend=FakeAudioBackend())
    with pytest.raises(RuntimeError):
        adapter.read()


def test_close_is_idempotent() -> None:
    backend = FakeAudioBackend()
    adapter = AudioAdapter(backend=backend)
    adapter.open_input()

    adapter.close()
    adapter.close()

    assert adapter.is_open is False
    # close() only touches the device while it is held.
    assert backend.close_count == 1
