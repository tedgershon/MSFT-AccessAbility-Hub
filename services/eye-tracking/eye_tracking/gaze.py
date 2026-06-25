"""Iris-based gaze estimation and screen calibration.

The strongest CV stack lives in Python, so eye tracking owns the gaze math. Two
pieces live here:

* :class:`GazeEstimator` - turns a camera frame into a normalized gaze *feature*
  using MediaPipe Face Mesh iris landmarks (iris position relative to the eye
  corners / eyelids). The feature is roughly in ``[0, 1]`` per axis and is largely
  invariant to where the face sits in the frame.
* :class:`Calibrator` - fits an affine map from gaze features to *screen* pixels
  from a handful of look-at-this-point samples (least squares). This is what turns
  "where the iris is" into "where on screen you're looking".

MediaPipe is imported lazily so :class:`Calibrator` (pure NumPy) stays importable
and unit-testable on machines without the heavy CV dependency.
"""

from __future__ import annotations

import os
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

# MediaPipe Face Mesh landmark indices (the face_landmarker model emits 478 points,
# the last 10 being the irises).
LEFT_IRIS_CENTER = 468
RIGHT_IRIS_CENTER = 473
# (outer corner, inner corner, upper lid, lower lid) per eye.
LEFT_EYE = (33, 133, 159, 145)
RIGHT_EYE = (362, 263, 386, 374)

# Official MediaPipe face landmarker bundle (includes iris landmarks). Override the
# location with AAH_FACE_LANDMARKER to use a pre-downloaded copy / run offline.
_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
_MODEL_CACHE = Path.home() / ".cache" / "aah" / "face_landmarker.task"


def ensure_face_landmarker_model(path: str | os.PathLike[str] | None = None) -> Path:
    """Return a local path to the face landmarker model, downloading it if needed."""
    target = Path(path or os.environ.get("AAH_FACE_LANDMARKER") or _MODEL_CACHE)
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading face landmarker model -> {target}", flush=True)
    urllib.request.urlretrieve(_MODEL_URL, target)  # noqa: S310 (trusted Google CDN)
    return target


@dataclass(slots=True)
class GazeReading:
    """Result of processing a single frame."""

    feature: tuple[float, float] | None
    left_iris: tuple[int, int] | None = None
    right_iris: tuple[int, int] | None = None
    eye_points: list[tuple[int, int]] = field(default_factory=list)

    @property
    def has_face(self) -> bool:
        return self.feature is not None


def _ratio(value: float, low: float, high: float) -> float:
    span = high - low
    if span == 0:
        return 0.5
    return (value - low) / span


class GazeEstimator:
    """Turns frames into normalized gaze features via MediaPipe iris landmarks."""

    def __init__(
        self,
        *,
        model_path: str | os.PathLike[str] | None = None,
        min_detection_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
    ) -> None:
        import mediapipe as mp  # lazy: keep Calibrator importable without mediapipe
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision

        self._mp = mp
        model = ensure_face_landmarker_model(model_path)
        options = vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(model)),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence,
        )
        self._landmarker = vision.FaceLandmarker.create_from_options(options)
        self._frame_index = 0

    def process(self, frame_bgr: Any) -> GazeReading:
        import cv2

        height, width = frame_bgr.shape[:2]
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        # VIDEO mode needs a monotonically increasing timestamp; ~30 fps is fine.
        timestamp_ms = self._frame_index * 33
        self._frame_index += 1
        result = self._landmarker.detect_for_video(image, timestamp_ms)
        if not result.face_landmarks:
            return GazeReading(feature=None)

        landmarks = result.face_landmarks[0]

        def px(index: int) -> tuple[int, int]:
            point = landmarks[index]
            return (int(point.x * width), int(point.y * height))

        left_iris = px(LEFT_IRIS_CENTER)
        right_iris = px(RIGHT_IRIS_CENTER)
        left = self._eye_feature(left_iris, LEFT_EYE, px)
        right = self._eye_feature(right_iris, RIGHT_EYE, px)
        feature = ((left[0] + right[0]) / 2.0, (left[1] + right[1]) / 2.0)
        eye_points = [px(i) for eye in (LEFT_EYE, RIGHT_EYE) for i in eye]
        return GazeReading(
            feature=feature,
            left_iris=left_iris,
            right_iris=right_iris,
            eye_points=eye_points,
        )

    @staticmethod
    def _eye_feature(iris, eye_indices, px) -> tuple[float, float]:
        outer, inner, upper, lower = (px(i) for i in eye_indices)
        horizontal = _ratio(iris[0], outer[0], inner[0])
        vertical = _ratio(iris[1], upper[1], lower[1])
        return horizontal, vertical

    def close(self) -> None:
        self._landmarker.close()


class Calibrator:
    """Least-squares affine map from gaze features to screen pixels."""

    def __init__(self) -> None:
        self._features: list[tuple[float, float]] = []
        self._targets: list[tuple[float, float]] = []
        self._model: np.ndarray | None = None

    def add_sample(self, feature: tuple[float, float], target: tuple[float, float]) -> None:
        self._features.append(feature)
        self._targets.append(target)

    @property
    def sample_count(self) -> int:
        return len(self._features)

    @property
    def is_calibrated(self) -> bool:
        return self._model is not None

    def fit(self) -> bool:
        """Fit the affine model. Needs >= 3 non-degenerate samples."""
        if len(self._features) < 3:
            return False
        design = np.array([[gx, gy, 1.0] for (gx, gy) in self._features])
        targets = np.array(self._targets, dtype=float)
        model, _residuals, rank, _sv = np.linalg.lstsq(design, targets, rcond=None)
        if rank < 3:
            return False
        self._model = model
        return True

    def predict(self, feature: tuple[float, float]) -> tuple[float, float] | None:
        if self._model is None:
            return None
        vector = np.array([feature[0], feature[1], 1.0])
        screen = vector @ self._model
        return (float(screen[0]), float(screen[1]))

    def reset(self) -> None:
        self._features.clear()
        self._targets.clear()
        self._model = None
