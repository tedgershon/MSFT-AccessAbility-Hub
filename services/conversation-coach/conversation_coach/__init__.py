"""Conversation Coach service (Python) — issue #26, autism support tile.

During a video/voice call this service watches the camera and listens to the mic,
detects conversational cues going awry (monologuing, talking over, missed turn
signals, disengagement, awkward silence), and *privately* surfaces short repair
prompts to the user via the shared overlay channel — never to the other party.

Design (Single Responsibility / Open–Closed):
* Decision logic lives in :mod:`coaching` as swappable cue detectors.
* Camera + mic are held behind :class:`~conversation_coach.perception.PerceptionSource`
  as one logical lease, opened in ``on_enable`` and **released in ``on_disable``**
  (contract rule 5).
* Output goes out as overlay events on the event bus — the service never calls
  another service and never drives the cursor/keyboard.

Runs in its own process (CV/audio heavy) and talks to the kernel only across the
IPC seam. Declares ``camera``/``audioIn`` as ``shared`` (it only observes, so a call
app or captions service may co-hold them) and ``displayOverlay`` as ``shared``.

The service needs a steady window loop (poll camera/mic, run inference, emit overlay
updates) but does not own a thread for it: it opts into the IPC host's shared periodic
pump by declaring ``tick_interval_s`` and implementing :meth:`tick`. The host starts
the pump after ``on_enable`` and stops/joins it before ``on_disable`` (issue #60).
"""

from __future__ import annotations

from aah_contracts import (
    OVERLAY_ATTACH,
    OVERLAY_DETACH,
    OVERLAY_UPDATE,
    AccessibilityService,
    Capability,
    HealthStatus,
    OverlayLayer,
    ServiceContext,
    ServiceMeta,
    degraded,
    healthy,
    unhealthy,
)

from .coaching import ConversationCoach, RepairPrompt
from .perception import PerceptionSource, ScriptedPerception


class ConversationCoachService(AccessibilityService):
    meta = ServiceMeta(id="conversation-coach", name="Conversation Coach", version="0.1.0")
    requires = [
        Capability(resource="camera", mode="shared"),
        Capability(resource="audioIn", mode="shared"),
        Capability(resource="displayOverlay", mode="shared"),
    ]

    #: Stable overlay layer id for this service's private prompt panel.
    LAYER_ID = "conversation-coach:prompts"

    def __init__(
        self,
        perception: PerceptionSource | None = None,
        coach: ConversationCoach | None = None,
        *,
        tick_interval_s: float = 0.5,
    ) -> None:
        # Injectable for tests; defaults keep the service hardware-free. The real
        # camera/mic AdapterPerception is wired in __main__ for the live process.
        self._perception: PerceptionSource = perception or ScriptedPerception()
        self._coach = coach or ConversationCoach()
        self._ctx: ServiceContext | None = None
        self._active = False
        self._mounted = False
        self._last: list[RepairPrompt] = []
        # The host's periodic pump reads this to drive tick() while enabled (issue #60);
        # the service owns no thread. Tests step tick() directly for determinism.
        self.tick_interval_s = tick_interval_s

    async def on_load(self, ctx: ServiceContext) -> None:
        self._ctx = ctx

    async def on_enable(self) -> None:
        ctx = self._ctx
        if ctx is None:
            return
        # Acquire the camera + mic lease, then mount the (empty) private overlay. The
        # host starts ticking us once this returns.
        self._perception.open()
        self._coach.reset()
        self._active = True
        self._last = []
        ctx.bus.emit(OVERLAY_ATTACH, self._overlay_layer([]))
        self._mounted = True

    async def on_disable(self) -> None:
        ctx = self._ctx
        # The host has already stopped the pump, so no tick races this teardown. Release
        # the camera/mic lease (rule 5) and tear down the overlay — even if enable
        # half-failed, so we never leak the devices or a stale layer.
        self._active = False
        self._perception.close()
        if ctx is not None and self._mounted:
            ctx.bus.emit(OVERLAY_DETACH, {"id": self.LAYER_ID, "owner_id": ctx.self_id})
        self._mounted = False
        self._last = []

    async def on_unload(self) -> None:
        self._ctx = None

    def tick(self) -> list[RepairPrompt]:
        """Process one perception window and surface any repair prompts.

        Emits an ``overlay/update`` whenever the surfaced prompt set *changes* —
        including back to empty, so a prompt is cleared once it stops firing rather
        than staying stuck on screen. Returns the prompts emitted this tick (empty
        when idle). The IPC host's periodic pump drives this on a timer while enabled;
        it's a single public step so tests can drive it deterministically.
        """

        ctx = self._ctx
        if not self._active or ctx is None:
            return []
        signal = self._perception.poll()
        if signal is None:
            return []
        prompts = self._coach.assess(signal)
        if self._prompt_keys(prompts) != self._prompt_keys(self._last):
            self._last = prompts
            ctx.bus.emit(OVERLAY_UPDATE, self._overlay_layer(prompts))
        return prompts

    def _overlay_layer(self, prompts: list[RepairPrompt]) -> OverlayLayer:
        """Build the shared :class:`OverlayLayer` contract for the prompt panel.

        Emits the contract dataclass (snake_case ``owner_id``) rather than a hand-rolled
        camelCase dict: the IPC seam serializer converts it to the TS ``ownerId`` wire
        shape, so the shared type stays the single source of truth (issue #57).
        ``self_id`` is non-None whenever this is called (only from enabled paths that
        checked ``ctx``).
        """

        assert self._ctx is not None
        return OverlayLayer(
            id=self.LAYER_ID,
            owner_id=self._ctx.self_id,
            kind="coach-prompts",
            params={
                "prompts": [
                    {"key": p.key, "text": p.text, "severity": p.severity} for p in prompts
                ]
            },
        )

    @staticmethod
    def _prompt_keys(prompts: list[RepairPrompt]) -> list[str]:
        return [p.key for p in prompts]

    def health_check(self) -> HealthStatus:
        if self._ctx is None:
            return degraded("not loaded")
        if self._active and not self._perception.is_open:
            # Lease dropped underneath us — unhealthy so the supervisor restarts us
            # (it only recovers on `unhealthy`, not `degraded`).
            return unhealthy("perception lease lost")
        return healthy("coaching" if self._active else "idle")
