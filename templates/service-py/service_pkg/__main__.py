"""Process entry point for the __SERVICE_NAME__ service."""

from __future__ import annotations

from aah_ipc import run_stdio_host

from . import __SERVICE_CLASS__Service


def main() -> None:
    # Host the service over stdio: inbound lifecycle frames drive its hooks and
    # health/event frames flow back to the kernel. Blocks until stdin reaches EOF.
    run_stdio_host(__SERVICE_CLASS__Service())


if __name__ == "__main__":
    main()
