# Coordinator test plan

> No tests are implemented in this scaffold. This file pins the intended suites.

Place specs here as `*.test.ts`.

## Mode State Machine (`mode-state-machine.test.ts`)
- starts in the declared initial mode.
- `switchTo` a registered mode updates `active` and appends to `history`.
- `switchTo` an unregistered mode throws.
- rejecting an empty mode set / invalid initial mode.

## Mode Coordinator (`mode-coordinator.test.ts`)
- `arbitrate(channel, candidates)` emits `coordinator/mode-switch-requested`.
- `switchTo` emits `coordinator/mode-changed` with the active service id.
- `GAZE_ACTIVE <-> VOICE_ACTIVE` handoff: foregrounding flips the active mode and
  is the signal the arbiter uses to move the exclusive lease.
