"""Process entry point for the voice-commands service.

Out-of-process service: the kernel host launches this module, hands it a
:class:`~aah_contracts.ServiceContext` whose ``bus`` is an IPC client to the kernel
Event Bus, then drives the lifecycle. ``input/intent`` events the service emits flow
back over that same seam. The concrete IPC transport is owned by the host, not here.
"""

from __future__ import annotations

from . import VoiceCommandsService


def main() -> None:
    service = VoiceCommandsService()
    # The host process injects a ServiceContext over IPC, registers `service`, and
    # runs the on_load -> on_enable -> ... lifecycle. Kept transport-agnostic so this
    # service never hard-codes a bridge.
    _ = service


if __name__ == "__main__":
    main()
