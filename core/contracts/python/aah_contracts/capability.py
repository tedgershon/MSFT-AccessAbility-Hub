"""Capability manifest types (Python mirror of capability.ts)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Resource = Literal[
    "camera",
    "audioIn",
    "audioOut",
    "cursor",
    "keyboard",
    "browser",
    "displayOverlay",
    "commandChannel",
]

AccessMode = Literal["exclusive", "shared"]


@dataclass(frozen=True, slots=True)
class Capability:
    """A single declared resource requirement."""

    resource: Resource
    mode: AccessMode
