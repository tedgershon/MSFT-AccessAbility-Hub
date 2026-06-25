"""Unit tests for the gaze Calibrator (pure NumPy, no camera/mediapipe)."""

from __future__ import annotations

from eye_tracking.gaze import Calibrator


def test_calibrator_recovers_affine_mapping() -> None:
    cal = Calibrator()
    # True mapping: screen_x = 1920 * gx, screen_y = 1080 * gy.
    for feature, target in [
        ((0.0, 0.0), (0.0, 0.0)),
        ((1.0, 0.0), (1920.0, 0.0)),
        ((0.0, 1.0), (0.0, 1080.0)),
        ((1.0, 1.0), (1920.0, 1080.0)),
        ((0.5, 0.5), (960.0, 540.0)),
    ]:
        cal.add_sample(feature, target)

    assert cal.fit()
    assert cal.is_calibrated

    sx, sy = cal.predict((0.25, 0.75))
    assert abs(sx - 480.0) < 1e-6
    assert abs(sy - 810.0) < 1e-6


def test_calibrator_needs_three_nondegenerate_samples() -> None:
    cal = Calibrator()
    cal.add_sample((0.0, 0.0), (0.0, 0.0))
    cal.add_sample((1.0, 1.0), (10.0, 10.0))

    assert not cal.fit()
    assert cal.predict((0.5, 0.5)) is None


def test_calibrator_reset_clears_state() -> None:
    cal = Calibrator()
    for feature, target in [
        ((0.0, 0.0), (0.0, 0.0)),
        ((1.0, 0.0), (10.0, 0.0)),
        ((0.0, 1.0), (0.0, 10.0)),
    ]:
        cal.add_sample(feature, target)
    assert cal.fit()

    cal.reset()
    assert cal.sample_count == 0
    assert not cal.is_calibrated
    assert cal.predict((0.5, 0.5)) is None
