"""Process entry point for the gaze dwell service."""

from __future__ import annotations

from aah_contracts import CALIBRATION_STATE, GAZE_POINT, INPUT_CONTEXT, INPUT_INTENT
from aah_host import run_stdio_host

from . import GazeDwellService


def main() -> None:
    run_stdio_host(
        [GazeDwellService()],
        inbound=[GAZE_POINT, CALIBRATION_STATE],
        outbound=[INPUT_INTENT, INPUT_CONTEXT],
    )


if __name__ == "__main__":
    main()
