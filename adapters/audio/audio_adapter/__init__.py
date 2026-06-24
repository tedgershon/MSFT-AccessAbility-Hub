"""Audio adapter.

Wraps microphone capture behind a narrow interface so audio services never touch
the device API directly (Adapter pattern). Holding the input stream corresponds to
an ``exclusive`` audioIn lease; releasing it (``close``) MUST happen on disable.

The device API is abstracted behind :class:`AudioBackend`, so the adapter runs
hardware-free in tests via :class:`FakeAudioBackend`. The default backend talks to
real hardware through ``sounddevice``, imported lazily and guarded so this module
imports cleanly on machines without audio hardware or the optional dependency.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

#: A single block of captured audio. Raw PCM bytes in production; tests may use any
#: ``bytes`` payload the injected recognizer understands.
AudioChunk = bytes


@runtime_checkable
class AudioBackend(Protocol):
    """The narrow device surface the adapter drives.

    Real hardware and hardware-free fakes both implement this, so the adapter (and
    every service above it) is fully testable without a microphone.
    """

    def open(self) -> None:
        """Acquire/start the capture device."""
        ...

    def read_chunk(self) -> AudioChunk | None:
        """Return the next audio block, or ``None`` when none is available yet."""
        ...

    def close(self) -> None:
        """Release/stop the capture device."""
        ...


class FakeAudioBackend:
    """Deterministic, hardware-free backend for tests.

    Yields queued chunks in order, then ``None`` (stream idle). Tracks whether the
    device is currently held so tests can assert it is released on ``close``.
    """

    def __init__(self, chunks: list[AudioChunk] | None = None) -> None:
        self._queued: list[AudioChunk] = list(chunks or [])
        self.opened = False
        self.closed = False
        self.open_count = 0
        self.close_count = 0

    def feed(self, chunk: AudioChunk) -> None:
        """Queue another chunk to be returned by a later :meth:`read_chunk`."""
        self._queued.append(chunk)

    def open(self) -> None:
        self.opened = True
        self.closed = False
        self.open_count += 1

    def read_chunk(self) -> AudioChunk | None:
        if not self.opened:
            raise RuntimeError("audio backend is not open")
        if self._queued:
            return self._queued.pop(0)
        return None

    def close(self) -> None:
        self.opened = False
        self.closed = True
        self.close_count += 1


class SoundDeviceBackend:  # pragma: no cover - requires real audio hardware
    """Real microphone backend backed by ``sounddevice``.

    ``sounddevice`` is imported lazily inside :meth:`open` so importing this module
    never requires the optional dependency or a physical device.
    """

    def __init__(
        self,
        device_index: int = 0,
        sample_rate: int = 16_000,
        block_size: int = 1600,
    ) -> None:
        self._device_index = device_index
        self._sample_rate = sample_rate
        self._block_size = block_size
        self._stream: object | None = None

    def open(self) -> None:
        try:
            import sounddevice  # type: ignore[import-not-found]
        except Exception as exc:
            raise RuntimeError(
                "sounddevice is not installed; install the optional audio backend "
                "or inject an AudioBackend explicitly."
            ) from exc
        stream = sounddevice.RawInputStream(
            samplerate=self._sample_rate,
            blocksize=self._block_size,
            device=self._device_index,
            channels=1,
            dtype="int16",
        )
        stream.start()
        self._stream = stream

    def read_chunk(self) -> AudioChunk | None:
        if self._stream is None:
            raise RuntimeError("audio backend is not open")
        data, _overflow = self._stream.read(self._block_size)  # type: ignore[attr-defined]
        return bytes(data)

    def close(self) -> None:
        if self._stream is not None:
            self._stream.stop()  # type: ignore[attr-defined]
            self._stream.close()  # type: ignore[attr-defined]
            self._stream = None


class AudioAdapter:
    """Microphone capture behind a stable, hardware-free interface.

    Holding the input stream represents the ``exclusive`` audioIn lease; callers
    MUST release it via :meth:`close` (i.e. in the owning service's ``on_disable``).
    """

    def __init__(
        self,
        *,
        backend: AudioBackend | None = None,
        device_index: int = 0,
        sample_rate: int = 16_000,
        block_size: int = 1600,
    ) -> None:
        self._device_index = device_index
        self._sample_rate = sample_rate
        self._block_size = block_size
        self._backend = backend
        self._open = False

    def _ensure_backend(self) -> AudioBackend:
        if self._backend is None:
            self._backend = SoundDeviceBackend(
                device_index=self._device_index,
                sample_rate=self._sample_rate,
                block_size=self._block_size,
            )
        return self._backend

    def open_input(self) -> None:
        """Acquire the microphone (the audioIn lease)."""
        backend = self._ensure_backend()
        backend.open()
        self._open = True

    def read(self) -> AudioChunk | None:
        """Return the next audio block, or ``None`` if none is available yet."""
        if not self._open or self._backend is None:
            raise RuntimeError("audio input is not open; call open_input() first")
        return self._backend.read_chunk()

    def close(self) -> None:
        """Release the microphone (the audioIn lease). Safe to call repeatedly."""
        if self._backend is not None and self._open:
            self._backend.close()
        self._open = False

    @property
    def is_open(self) -> bool:
        return self._open
