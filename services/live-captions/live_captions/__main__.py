"""Process entry point for the Live Captions service."""

from __future__ import annotations

from aah_ipc import run_stdio_host

from . import LiveCaptionsService


def main() -> None:
    # Host the service over stdio: inbound lifecycle frames drive its hooks and
    # health/event frames flow back to the kernel. Blocks until stdin reaches EOF.
    run_stdio_host(LiveCaptionsService())


if __name__ == "__main__":
    main()
