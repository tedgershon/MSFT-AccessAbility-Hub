"""Process entry point for the Conversation Coach service.

Runs as its own process and talks to the kernel only across the IPC seam (event
bus), never via direct calls. The kernel host registers the service, drives the
lifecycle, and pumps :meth:`ConversationCoachService.tick` once per perception
window; the wiring is left to the IPC bridge so this module stays import-safe.
"""

from __future__ import annotations

from . import ConversationCoachService


def main() -> None:
    service = ConversationCoachService()
    # TODO: connect to the kernel IPC bridge, register `service`, supply a real
    # camera+mic PerceptionSource, and pump `service.tick()` on each window.
    _ = service


if __name__ == "__main__":
    main()
