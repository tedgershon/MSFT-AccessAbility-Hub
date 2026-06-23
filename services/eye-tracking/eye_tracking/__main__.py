"""Process entry point for the eye-tracking service.

Each compute-heavy service runs as its own process and talks to the kernel only
across the IPC seam (event bus), never via direct calls.
"""

from __future__ import annotations

from . import EyeTrackingService


def main() -> None:
    service = EyeTrackingService()
    # TODO: connect to the kernel IPC bridge, register `service`, and run the loop.
    _ = service


if __name__ == "__main__":
    main()
