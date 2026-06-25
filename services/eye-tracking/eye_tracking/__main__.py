"""Process entry point for the eye-tracking service.

Each compute-heavy service runs as its own process and talks to the kernel only
across the IPC seam (event bus), never via direct calls.
"""

from __future__ import annotations

from aah_contracts import CALIBRATION_STATE, CAMERA_FRAME_REF, CAMERA_GAZE
from aah_host import run_stdio_host

from . import EyeTrackingService


def main() -> None:
    # Eye tracking is a producer: it publishes camera frame refs and calibration
    # state up to the kernel and consumes nothing from it yet.
    run_stdio_host(
        [EyeTrackingService()],
        inbound=[],
        outbound=[CAMERA_FRAME_REF, CAMERA_GAZE, CALIBRATION_STATE],
    )


if __name__ == "__main__":
    main()
