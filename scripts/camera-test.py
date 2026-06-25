"""Persistent camera test runner.

Runs the camera adapter continuously in either preview mode (window, press q to
quit) or headless mode (fps log, Ctrl+C to quit).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "adapters" / "camera"))

from camera_adapter import CameraAdapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run persistent camera test")
    parser.add_argument("--device", type=int, default=0, help="Camera device index")
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run without preview window and print frames per second",
    )
    return parser.parse_args()


def run_headless(device_index: int) -> None:
    cam = CameraAdapter(device_index=device_index)
    cam.open()
    print("Camera running in headless mode. Press Ctrl+C to stop.")

    frames = 0
    tick = time.time()
    try:
        while True:
            frame = cam.read()
            if frame is not None:
                frames += 1
            now = time.time()
            if now - tick >= 1:
                print(f"frames/sec ~= {frames}")
                frames = 0
                tick = now
    except KeyboardInterrupt:
        pass
    finally:
        cam.close()
        print("Stopped.")


def run_preview(device_index: int) -> None:
    import cv2

    cam = CameraAdapter(device_index=device_index)
    cam.open()
    print("Camera running in preview mode. Press q to stop.")

    try:
        while True:
            frame = cam.read()
            if frame is None:
                continue
            cv2.imshow("Camera Test", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        cam.close()
        cv2.destroyAllWindows()
        print("Stopped.")


def main() -> int:
    args = parse_args()
    if args.headless:
        run_headless(args.device)
    else:
        run_preview(args.device)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
