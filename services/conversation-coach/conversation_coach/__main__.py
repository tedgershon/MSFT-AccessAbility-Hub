"""Process entry point for the Conversation Coach service.

Runs as its own process and talks to the kernel only across the IPC seam (event
bus), never via direct calls. :func:`aah_ipc.run_stdio_host` hosts the service over
stdio: inbound ``lifecycle`` frames drive its hooks, and the service's own window loop
(started on enable) polls the real camera + mic via :class:`AdapterPerception`,
emitting overlay events back across the seam.

The perception model is wired here: :class:`WindowedSignalExtractor` fuses each live
camera frame + audio chunk into :class:`~conversation_coach.coaching.ConversationSignal`
windows (mic voice-activity for the user, face/gaze inference for the partner), so the
coach surfaces prompts from real conversational cues. The extractor is injected into
``AdapterPerception`` — the service body is unchanged.
"""

from __future__ import annotations

from aah_ipc import run_stdio_host

from . import ConversationCoachService
from .perception import AdapterPerception, WindowedSignalExtractor


def main() -> None:
    service = ConversationCoachService(
        perception=AdapterPerception(extractor=WindowedSignalExtractor()),
    )
    run_stdio_host(service)


if __name__ == "__main__":
    main()
