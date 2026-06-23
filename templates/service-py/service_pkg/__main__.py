"""Process entry point for the __SERVICE_NAME__ service."""

from __future__ import annotations

from . import __SERVICE_CLASS__Service


def main() -> None:
    service = __SERVICE_CLASS__Service()
    # TODO: connect to the kernel IPC bridge, register `service`, and run the loop.
    _ = service


if __name__ == "__main__":
    main()
