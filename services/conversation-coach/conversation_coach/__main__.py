"""Process entry point for the Conversation Coach service.

Runs as its own process and talks to the kernel only across the IPC seam (event
bus), never via direct calls. :func:`aah_ipc.run_stdio_host` hosts the service over
stdio: inbound ``lifecycle`` frames drive its hooks, and the service's own window loop
(started on enable) polls the real camera + mic via :class:`AdapterPerception`,
emitting overlay events back across the seam.

The remaining injection point is the perception model: wire a real
:class:`~conversation_coach.perception.SignalExtractor` into ``AdapterPerception`` to
turn live frames + audio into :class:`~conversation_coach.coaching.ConversationSignal`
windows. Until then it runs with ``NullSignalExtractor`` (devices open, no inference).
"""

from __future__ import annotations

from aah_ipc import run_stdio_host

from . import ConversationCoachService
from .perception import AdapterPerception


def main() -> None:
    service = ConversationCoachService(perception=AdapterPerception())
    run_stdio_host(service)


if __name__ == "__main__":
    main()
