"""Lifecycle + behaviour tests for the Conversation Coach service.

Hardware-free: a :class:`ScriptedPerception` stands in for the camera/mic and the
root ``conftest.py`` ``CapturingBus`` records emitted overlay events. Async hooks
are driven with ``asyncio.run`` so no pytest-asyncio plugin is required. The window
loop is driven by stepping :meth:`tick` directly, so these stay deterministic — the
host's periodic pump that calls ``tick`` in production is tested in ``aah-ipc``.
"""

from __future__ import annotations

import asyncio
import json

from aah_contracts import (
    OVERLAY_ATTACH,
    OVERLAY_DETACH,
    OVERLAY_UPDATE,
    OverlayLayer,
    ServiceContext,
)
from aah_ipc import EventFrame, encode_frame

from conversation_coach import ConversationCoachService
from conversation_coach.coaching import ConversationSignal
from conversation_coach.perception import ScriptedPerception


def _ctx(bus) -> ServiceContext:
    return ServiceContext(self_id="conversation-coach", bus=bus, config={})


def _payloads(bus, topic):
    return [p for t, p in bus.emitted if t == topic]


def _wire(topic, payload):
    """Serialize an emitted overlay payload across the real IPC seam.

    The service emits the shared ``OverlayLayer`` contract (snake_case ``owner_id``);
    the seam must convert it to the TS wire shape (camelCase ``ownerId``) — that
    conversion is the whole point of issue #57, so lock it in here.
    """

    return json.loads(encode_frame(EventFrame(topic=topic, payload=payload)))["payload"]


def test_requires_manifest_is_observe_only(capturing_bus) -> None:
    svc = ConversationCoachService()
    by_resource = {c.resource: c.mode for c in svc.requires}
    assert by_resource == {
        "camera": "shared",
        "audioIn": "shared",
        "displayOverlay": "shared",
    }


def test_enable_acquires_lease_and_mounts_overlay(capturing_bus) -> None:
    perception = ScriptedPerception()
    svc = ConversationCoachService(perception=perception)

    asyncio.run(svc.on_load(_ctx(capturing_bus)))
    asyncio.run(svc.on_enable())

    assert perception.is_open is True
    assert perception.open_count == 1
    attaches = _payloads(capturing_bus, OVERLAY_ATTACH)
    assert len(attaches) == 1
    # The service emits the shared contract type, not a hand-rolled dict (issue #57).
    assert attaches[0] == OverlayLayer(
        id="conversation-coach:prompts",
        owner_id="conversation-coach",
        kind="coach-prompts",
        params={"prompts": []},
    )
    # ...and the IPC seam serializes it to the camelCase TS wire shape.
    assert _wire(OVERLAY_ATTACH, attaches[0]) == {
        "id": "conversation-coach:prompts",
        "ownerId": "conversation-coach",
        "kind": "coach-prompts",
        "params": {"prompts": []},
    }


def test_disable_releases_lease_and_detaches_overlay(capturing_bus) -> None:
    perception = ScriptedPerception()
    svc = ConversationCoachService(perception=perception)

    asyncio.run(svc.on_load(_ctx(capturing_bus)))
    asyncio.run(svc.on_enable())
    asyncio.run(svc.on_disable())

    # Rule 5: camera/mic lease released on disable.
    assert perception.is_open is False
    assert perception.close_count == 1
    detaches = _payloads(capturing_bus, OVERLAY_DETACH)
    assert len(detaches) == 1
    # Detach carries the contract ``{id, owner_id}``; the seam casts it to camelCase so
    # the host overlay surface can scope the detach by owner.
    assert detaches[0] == {"id": "conversation-coach:prompts", "owner_id": "conversation-coach"}
    assert _wire(OVERLAY_DETACH, detaches[0]) == {
        "id": "conversation-coach:prompts",
        "ownerId": "conversation-coach",
    }


def test_exposes_host_tick_surface(capturing_bus) -> None:
    # The service opts into the IPC host's periodic pump (issue #60) rather than owning
    # a thread: it implements tick() and declares a positive interval.
    svc = ConversationCoachService()
    assert callable(svc.tick)
    assert isinstance(svc.tick_interval_s, (int, float))
    assert svc.tick_interval_s > 0


def test_tick_surfaces_prompt_via_overlay_update(capturing_bus) -> None:
    perception = ScriptedPerception([ConversationSignal(user_speaking_ratio=0.95)])
    svc = ConversationCoachService(perception=perception)

    asyncio.run(svc.on_load(_ctx(capturing_bus)))
    asyncio.run(svc.on_enable())
    prompts = svc.tick()

    assert [p.key for p in prompts] == ["monologue"]
    updates = _payloads(capturing_bus, OVERLAY_UPDATE)
    assert len(updates) == 1
    assert isinstance(updates[0], OverlayLayer)
    assert updates[0].owner_id == "conversation-coach"
    assert updates[0].params["prompts"][0]["key"] == "monologue"
    # The seam casts the same window to the camelCase TS wire shape.
    assert _wire(OVERLAY_UPDATE, updates[0])["ownerId"] == "conversation-coach"


def test_tick_clears_overlay_when_prompt_stops_firing(capturing_bus) -> None:
    # Same cue twice: it fires on window 1, then the throttle mutes it on window 2.
    # The overlay must clear to empty rather than leaving the prompt stuck on screen.
    perception = ScriptedPerception(
        [
            ConversationSignal(user_speaking_ratio=0.95),
            ConversationSignal(user_speaking_ratio=0.95),
        ]
    )
    svc = ConversationCoachService(perception=perception)

    asyncio.run(svc.on_load(_ctx(capturing_bus)))
    asyncio.run(svc.on_enable())
    assert [p.key for p in svc.tick()] == ["monologue"]
    assert svc.tick() == []  # throttled this window

    updates = _payloads(capturing_bus, OVERLAY_UPDATE)
    assert len(updates) == 2
    assert updates[0].params["prompts"][0]["key"] == "monologue"
    assert updates[1].params["prompts"] == []  # cleared


def test_tick_on_quiet_signal_emits_nothing(capturing_bus) -> None:
    perception = ScriptedPerception([ConversationSignal()])
    svc = ConversationCoachService(perception=perception)

    asyncio.run(svc.on_load(_ctx(capturing_bus)))
    asyncio.run(svc.on_enable())
    before = sum(1 for t, _ in capturing_bus.emitted if t == OVERLAY_UPDATE)
    assert svc.tick() == []
    after = sum(1 for t, _ in capturing_bus.emitted if t == OVERLAY_UPDATE)
    assert before == after == 0


def test_tick_when_disabled_is_a_noop(capturing_bus) -> None:
    perception = ScriptedPerception([ConversationSignal(user_speaking_ratio=0.95)])
    svc = ConversationCoachService(perception=perception)
    asyncio.run(svc.on_load(_ctx(capturing_bus)))
    # Not enabled.
    assert svc.tick() == []


def test_health_check_tracks_state(capturing_bus) -> None:
    perception = ScriptedPerception()
    svc = ConversationCoachService(perception=perception)

    assert svc.health_check().state == "degraded"  # not loaded

    asyncio.run(svc.on_load(_ctx(capturing_bus)))
    assert svc.health_check().state == "healthy"
    assert svc.health_check().detail == "idle"

    asyncio.run(svc.on_enable())
    assert svc.health_check().detail == "coaching"

    asyncio.run(svc.on_disable())
    assert svc.health_check().detail == "idle"


def test_health_check_unhealthy_if_lease_lost(capturing_bus) -> None:
    perception = ScriptedPerception()
    svc = ConversationCoachService(perception=perception)
    asyncio.run(svc.on_load(_ctx(capturing_bus)))
    asyncio.run(svc.on_enable())

    # Lease yanked out from under the service.
    perception.close()
    status = svc.health_check()
    # Unhealthy (not degraded) so the supervisor actually restarts the service.
    assert status.state == "unhealthy"
    assert "lease" in (status.detail or "")


