"""Process entry point for the voice-commands service."""

from __future__ import annotations

from . import VoiceCommandsService


def main() -> None:
    service = VoiceCommandsService()
    # TODO: connect to the kernel IPC bridge, register `service`, and run the loop.
    _ = service


if __name__ == "__main__":
    main()
