"""Process entry point for the gaze-correlation service.

Runs as its own process and talks to the kernel only across the IPC seam (event
bus), never via direct calls. It consumes camera + display frame refs from the
kernel and publishes correlated gaze points and calibration state back up.
"""

from __future__ import annotations

from aah_contracts import CALIBRATION_STATE, CAMERA_FRAME_REF, DISPLAY_FRAME_REF, GAZE_POINT
from aah_host import run_stdio_host

from . import GazeCorrelationService


def main() -> None:
    run_stdio_host(
        [GazeCorrelationService()],
        inbound=[CAMERA_FRAME_REF, DISPLAY_FRAME_REF],
        outbound=[GAZE_POINT, CALIBRATION_STATE],
    )


if __name__ == "__main__":
    main()
