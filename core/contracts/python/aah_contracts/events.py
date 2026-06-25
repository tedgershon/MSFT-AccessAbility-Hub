"""Event bus message contracts (Python mirror of events.ts).

Services never call each other directly; all cross-service communication flows as
typed events over the kernel Event Bus. Python-side services emit/consume these
topics across the IPC seam. This module mirrors the shared overlay render channel so
Python tiles (e.g. Live Captions) can surface overlays without abusing other topics.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class OverlayLayer:
    """A single renderable layer on the shared overlay surface.

    Generic by design so unrelated tiles (color correction, live captions, screen
    dim, ...) all reuse one render channel: ``kind`` discriminates and ``params``
    carries the kind-specific render data. Mirror of the TS ``OverlayLayer``.
    """

    id: str
    owner_id: str
    kind: str
    params: dict[str, Any] = field(default_factory=dict)


# Overlay render topics, mirrored from the TS ``EventMap``. Use these constants when
# emitting/subscribing so the wire topic matches the host process exactly.
OVERLAY_ATTACH = "overlay/attach"
OVERLAY_UPDATE = "overlay/update"
OVERLAY_DETACH = "overlay/detach"

# Multimodal context topics mirrored from the TS ``EventMap``.
CAMERA_FRAME_REF = "camera/frame-ref"
DISPLAY_FRAME_REF = "display/frame-ref"
GAZE_POINT = "gaze/point"
CALIBRATION_STATE = "calibration/state"
INPUT_CONTEXT = "input/context"
