"""Camera + microphone perception source for the Conversation Coach.

The coach needs *one* fused stream of conversational features. This module hides
the camera/mic behind a small :class:`PerceptionSource` protocol so the service can:

* hold the camera/mic as a single logical lease that is opened in ``on_enable`` and
  **released in ``on_disable``** (contract rule 5), and
* run entirely hardware-free in tests via :class:`ScriptedPerception`.

A real implementation would wrap the camera + audio adapters in this service's own
process and emit fused :class:`ConversationSignal` windows; that lives behind the
same protocol so the service body never changes.
"""

from __future__ import annotations

from collections import deque
from typing import Protocol

from .coaching import ConversationSignal


class PerceptionSource(Protocol):
    """A leased camera+mic feature stream.

    ``open`` acquires the devices, ``close`` releases them (must be idempotent), and
    ``poll`` returns the next analysed window or ``None`` when none is ready yet.
    """

    @property
    def is_open(self) -> bool: ...

    def open(self) -> None: ...

    def close(self) -> None: ...

    def poll(self) -> ConversationSignal | None: ...


class ScriptedPerception:
    """Hardware-free source that replays a fixed list of signals.

    Used by tests and by ``--demo`` runs. Tracks open/close so tests can assert the
    lease is released. Reads past the script return ``None`` (stream idle), matching
    the audio adapter's drained-stream behaviour.
    """

    def __init__(self, signals: list[ConversationSignal] | None = None) -> None:
        self._queue: deque[ConversationSignal] = deque(signals or [])
        self._open = False
        self.open_count = 0
        self.close_count = 0

    @property
    def is_open(self) -> bool:
        return self._open

    def open(self) -> None:
        if not self._open:
            self._open = True
            self.open_count += 1

    def close(self) -> None:
        if self._open:
            self._open = False
            self.close_count += 1

    def poll(self) -> ConversationSignal | None:
        if not self._open:
            raise RuntimeError("poll() before open()")
        if not self._queue:
            return None
        return self._queue.popleft()
