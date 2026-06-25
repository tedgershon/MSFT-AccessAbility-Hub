"""Live gaze demo: calibrate, then show where on screen you are looking.

Flow:
  1. A 3x3 grid of dots appears. Look at each highlighted dot and press SPACE to
     capture a sample. After the 9th, an affine map is fitted.
  2. Live mode draws a dot at the estimated screen gaze point and streams the
     screen coordinate to the terminal. Press ``c`` to recalibrate, ``q``/ESC quit.

Run (camera + CV extra required):
    pip install -e services/eye-tracking[gaze]
    .\\.venv\\Scripts\\python scripts\\gaze-demo.py --device 0

Keep your head reasonably still during and after calibration; the affine map keys
off iris-in-eye position, not head pose.
"""

from __future__ import annotations

import argparse
import sys
import time
import tkinter as tk
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "adapters" / "camera"))
sys.path.insert(0, str(ROOT / "services" / "eye-tracking"))

from camera_adapter import CameraAdapter  # noqa: E402  (path set above first)
from eye_tracking.gaze import Calibrator, GazeEstimator, GazeReading  # noqa: E402

WINDOW = "Gaze Demo"
SMOOTHING = 0.35
STATUS_INTERVAL_S = 0.15
TARGET_COLOR = (80, 80, 80)
ACTIVE_COLOR = (0, 215, 255)
GAZE_COLOR = (0, 0, 255)
TEXT_COLOR = (240, 240, 240)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Live gaze calibration demo")
    parser.add_argument("--device", type=int, default=0, help="Camera device index")
    return parser.parse_args()


def get_screen_size() -> tuple[int, int]:
    root = tk.Tk()
    root.withdraw()
    size = (root.winfo_screenwidth(), root.winfo_screenheight())
    root.destroy()
    return size


def calibration_targets(screen_w: int, screen_h: int) -> list[tuple[int, int]]:
    xs = [0.1, 0.5, 0.9]
    ys = [0.1, 0.5, 0.9]
    return [(int(fx * screen_w), int(fy * screen_h)) for fy in ys for fx in xs]


def smooth(
    previous: tuple[float, float] | None, current: tuple[float, float]
) -> tuple[float, float]:
    if previous is None:
        return current
    return (
        SMOOTHING * current[0] + (1 - SMOOTHING) * previous[0],
        SMOOTHING * current[1] + (1 - SMOOTHING) * previous[1],
    )


def draw_camera_inset(canvas, frame, reading: GazeReading) -> None:
    inset_w = 320
    scale = inset_w / frame.shape[1]
    inset = cv2.resize(frame, (inset_w, int(frame.shape[0] * scale)))
    for point in reading.eye_points:
        cv2.circle(inset, (int(point[0] * scale), int(point[1] * scale)), 1, (0, 255, 0), -1)
    for iris in (reading.left_iris, reading.right_iris):
        if iris is not None:
            cv2.circle(inset, (int(iris[0] * scale), int(iris[1] * scale)), 3, (0, 0, 255), -1)
    h, w = inset.shape[:2]
    canvas[10 : 10 + h, 10 : 10 + w] = inset


def put_text(canvas, text: str, org: tuple[int, int], scale: float = 0.8) -> None:
    cv2.putText(canvas, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, TEXT_COLOR, 2, cv2.LINE_AA)


def run_calibration(cam, estimator, screen_w, screen_h) -> Calibrator | None:
    import numpy as np

    targets = calibration_targets(screen_w, screen_h)
    calibrator = Calibrator()
    index = 0
    feature = None

    while index < len(targets):
        frame = cam.read()
        if frame is None:
            continue
        frame = cv2.flip(frame, 1)
        reading = estimator.process(frame)
        if reading.feature is not None:
            feature = smooth(feature, reading.feature)

        canvas = np.zeros((screen_h, screen_w, 3), dtype=np.uint8)
        for i, target in enumerate(targets):
            color = ACTIVE_COLOR if i == index else TARGET_COLOR
            cv2.circle(canvas, target, 18 if i == index else 10, color, -1)
        draw_camera_inset(canvas, frame, reading)
        status = "face OK" if reading.has_face else "NO FACE"
        put_text(
            canvas,
            f"Calibrate {index + 1}/{len(targets)} - look at the dot, press SPACE ({status})",
            (10, screen_h - 40),
        )

        cv2.imshow(WINDOW, canvas)
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            return None
        if key == 32 and reading.has_face and feature is not None:
            calibrator.add_sample(feature, targets[index])
            index += 1
            feature = None

    if not calibrator.fit():
        print("Calibration failed (degenerate samples); try again.", flush=True)
        return None
    print(f"Calibrated from {calibrator.sample_count} points.", flush=True)
    return calibrator


def run_live(cam, estimator, calibrator, screen_w, screen_h) -> str:
    import numpy as np

    feature = None
    last_status = 0.0
    print("Live gaze tracking. Press c to recalibrate, q/ESC to quit.", flush=True)

    while True:
        frame = cam.read()
        if frame is None:
            continue
        frame = cv2.flip(frame, 1)
        reading = estimator.process(frame)

        canvas = np.zeros((screen_h, screen_w, 3), dtype=np.uint8)
        point = None
        if reading.feature is not None:
            feature = smooth(feature, reading.feature)
            predicted = calibrator.predict(feature)
            if predicted is not None:
                px = int(min(max(predicted[0], 0), screen_w - 1))
                py = int(min(max(predicted[1], 0), screen_h - 1))
                point = (px, py)

        if point is not None:
            cv2.circle(canvas, point, 20, GAZE_COLOR, -1)
            cv2.circle(canvas, point, 40, GAZE_COLOR, 2)

        draw_camera_inset(canvas, frame, reading)
        label = f"gaze=({point[0]},{point[1]})" if point else "gaze=-- (no face)"
        put_text(canvas, f"{label}   [c]=recalibrate  [q]=quit", (10, screen_h - 40))

        now = time.time()
        if now - last_status >= STATUS_INTERVAL_S:
            print(f"[{time.strftime('%H:%M:%S')}] screen {label}", flush=True)
            last_status = now

        cv2.imshow(WINDOW, canvas)
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            return "quit"
        if key == ord("c"):
            return "recalibrate"


def main() -> int:
    args = parse_args()
    screen_w, screen_h = get_screen_size()

    try:
        estimator = GazeEstimator()
    except ImportError:
        print(
            "mediapipe is not installed. Run: pip install -e services/eye-tracking[gaze]",
            flush=True,
        )
        return 1

    cam = CameraAdapter(device_index=args.device)
    cam.open()
    cv2.namedWindow(WINDOW, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(WINDOW, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)

    try:
        while True:
            calibrator = run_calibration(cam, estimator, screen_w, screen_h)
            if calibrator is None:
                break
            if run_live(cam, estimator, calibrator, screen_w, screen_h) == "quit":
                break
    finally:
        cam.close()
        estimator.close()
        cv2.destroyAllWindows()
        print("Stopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
