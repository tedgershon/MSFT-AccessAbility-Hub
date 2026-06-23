# Testing architecture

No tests ship in this scaffold. This document describes the harness so suites can
be added without re-deciding structure.

## Two runners, one entry point

| Side   | Runner   | Where specs live                            | Shared helpers              |
| ------ | -------- | ------------------------------------------- | --------------------------- |
| TS     | Vitest   | `*.test.ts` next to source / `test/`        | `@aah/test-fixtures`        |
| Python | pytest   | `test_*.py` next to source                  | root `conftest.py` fixtures |

Unit tests stay co-located with their source. Cross-package and cross-language
(IPC-seam) tests live at the top level under [tests/integration](tests/integration).

`task test` runs both. `task test:ts` / `task test:py` run one side.

## TS helpers — `@aah/test-fixtures` ([tests/fixtures](tests/fixtures))

- `FakeService` — instrumented `AccessibilityService` with configurable `requires`,
  `healthCheck`, and a `failOn` hook to exercise crash isolation.
- `CapturingBus` — an `EventBus` that records every emitted `(topic, payload)`.
- `LifecycleLog` — ordered record of lifecycle hook calls.

## Python helpers — `conftest.py`

- `FakeService`, `CapturingBus`, `LifecycleLog` mirroring the TS helpers, exposed as
  the `lifecycle_log` and `capturing_bus` fixtures.

## What to cover

Per-package unit-test plans live next to the code:

- [core/kernel/test/README.md](core/kernel/test/README.md)
- [core/coordinator/test/README.md](core/coordinator/test/README.md)

Service suites should assert: the `requires` manifest is correct, the camera/mic
lease is released in `onDisable`, and `healthCheck()` reflects enabled/disabled
state. Cross-language IPC is covered by integration tests under
[tests/integration](tests/integration) against the bus seam.
