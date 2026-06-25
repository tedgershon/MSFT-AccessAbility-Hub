"""Persistent camera test runner with face/eye detection.

Runs the camera adapter continuously and overlays OpenCV Haar-cascade face/eye
detection plus a rough gaze marker (midpoint of detected eyes). Works in two modes:

* preview  - shows a window with detection boxes drawn; press ``q`` to quit.
* headless - no window; detection still runs and is logged to the terminal.

Either way a status line is streamed to the terminal continuously so detection is
visible even without the preview window.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "adapters" / "camera"))

from camera_adapter import CameraAdapter  # noqa: E402  (path set above first)

# Box / marker colors in BGR (OpenCV order).
FACE_COLOR = (0, 255, 0)
EYE_COLOR = (255, 0, 0)
GAZE_COLOR = (0, 0, 255)
HUD_COLOR = (0, 255, 255)
# Throttle terminal status to a readable, continuous cadence (~7 lines/sec).
STATUS_INTERVAL_S = 0.15


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run persistent camera test")
    parser.add_argument("--device", type=int, default=0, help="Camera device index")
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run without a preview window (detection still logs to the terminal)",
    )
    parser.add_argument(
        "--no-detect",
        action="store_true",
        help="Disable face/eye detection and only stream raw capture stats",
    )
    return parser.parse_args()


def load_detectors(cv2):
    """Load the bundled Haar cascades, or ``None`` if they are unavailable."""
    base = Path(cv2.data.haarcascades)
    face = cv2.CascadeClassifier(str(base / "haarcascade_frontalface_default.xml"))
    eye = cv2.CascadeClassifier(str(base / "haarcascade_eye.xml"))
    if face.empty() or eye.empty():
        print("warning: could not load Haar cascades; detection disabled", flush=True)
        return None
    return face, eye


def detect_faces_eyes(detectors, gray) -> list[dict]:
    """Return detected faces with their eyes, all in full-frame coordinates."""
    face_cascade, eye_cascade = detectors
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))
    detections: list[dict] = []
    for (x, y, w, h) in faces:
        roi_gray = gray[y : y + h, x : x + w]
        eyes = eye_cascade.detectMultiScale(
            roi_gray, scaleFactor=1.1, minNeighbors=6, minSize=(20, 20)
        )
        eye_boxes = [
            (int(x + ex), int(y + ey), int(ew), int(eh)) for (ex, ey, ew, eh) in eyes
        ]
        detections.append({"face": (int(x), int(y), int(w), int(h)), "eyes": eye_boxes})
    return detections


def gaze_point(detections: list[dict]) -> tuple[int, int] | None:
    """Rough gaze proxy: mean of eye centers, else the first face center."""
    eye_centers = [
        (ex + ew // 2, ey + eh // 2)
        for det in detections
        for (ex, ey, ew, eh) in det["eyes"]
    ]
    if eye_centers:
        cx = sum(p[0] for p in eye_centers) // len(eye_centers)
        cy = sum(p[1] for p in eye_centers) // len(eye_centers)
        return (cx, cy)
    if detections:
        x, y, w, h = detections[0]["face"]
        return (x + w // 2, y + h // 2)
    return None


def format_status(fps: int, detections: list[dict], gaze: tuple[int, int] | None) -> str:
    faces = len(detections)
    eyes = sum(len(det["eyes"]) for det in detections)
    gaze_text = f"({gaze[0]:>4},{gaze[1]:>4})" if gaze else "  --,--  "
    return (
        f"[{time.strftime('%H:%M:%S')}] fps={fps:>2} "
        f"faces={faces} eyes={eyes} gaze={gaze_text}"
    )


def draw_overlay(cv2, frame, detections: list[dict], gaze, status: str) -> None:
    for det in detections:
        x, y, w, h = det["face"]
        cv2.rectangle(frame, (x, y), (x + w, y + h), FACE_COLOR, 2)
        for ex, ey, ew, eh in det["eyes"]:
            cv2.rectangle(frame, (ex, ey), (ex + ew, ey + eh), EYE_COLOR, 2)
    if gaze is not None:
        cv2.circle(frame, gaze, 6, GAZE_COLOR, -1)
        cv2.circle(frame, gaze, 14, GAZE_COLOR, 1)
    cv2.putText(
        frame, status, (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.6, HUD_COLOR, 1, cv2.LINE_AA
    )


def run(device_index: int, *, preview: bool, detect: bool) -> None:
    import cv2

    detectors = load_detectors(cv2) if detect else None
    cam = CameraAdapter(device_index=device_index)
    cam.open()

    mode = "preview" if preview else "headless"
    detect_state = "on" if detectors is not None else "off"
    print(f"Camera running in {mode} mode (detection {detect_state}).", flush=True)
    print("Press q in the window to stop." if preview else "Press Ctrl+C to stop.", flush=True)

    frames = 0
    fps = 0
    fps_tick = time.time()
    last_status = 0.0
    try:
        while True:
            frame = cam.read()
            if frame is None:
                continue

            frames += 1
            now = time.time()
            if now - fps_tick >= 1.0:
                fps = frames
                frames = 0
                fps_tick = now

            detections: list[dict] = []
            gaze = None
            if detectors is not None:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                detections = detect_faces_eyes(detectors, gray)
                gaze = gaze_point(detections)

            status = format_status(fps, detections, gaze)
            if now - last_status >= STATUS_INTERVAL_S:
                print(status, flush=True)
                last_status = now

            if preview:
                draw_overlay(cv2, frame, detections, gaze, status)
                cv2.imshow("Camera Test", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
    except KeyboardInterrupt:
        pass
    finally:
        cam.close()
        if preview:
            cv2.destroyAllWindows()
        print("Stopped.", flush=True)


def main() -> int:
    args = parse_args()
    run(args.device, preview=not args.headless, detect=not args.no_detect)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
