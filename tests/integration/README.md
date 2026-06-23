# Integration & cross-language tests

> No tests are implemented in this scaffold. This directory is the home for tests
> that do not belong to any single package.

Use this for:

- **Cross-package flows** — e.g. arbiter denies an exclusive lease → coordinator
  arbitrates → mode state machine hands off (`GAZE_ACTIVE <-> VOICE_ACTIVE`).
- **TS ↔ Python IPC-seam tests** — a Python service registering over the event-bus
  bridge and being driven through its lifecycle by the kernel host.
- **Crash-isolation / supervision** — kill a service process and assert peers and
  the baseline control path keep running.

TS specs (`*.test.ts`) are picked up here by the root `vitest.config.ts`. Python
integration tests (`test_*.py`) are collected by pytest via the root `pyproject.toml`
`testpaths`. Unit tests stay co-located with their source.
