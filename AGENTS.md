# AGENTS.md

Guidance for AI agents and humans working in this repo. Keep changes consistent
with the architecture; the kernel is deliberately small and must stay that way.

## What this is

A desktop accessibility hub: a microkernel host that loads isolated, toggleable
accessibility services (eye-tracking, voice, colorblind contrast, ClawPilot, ...).
The kernel knows nothing about specific disabilities — only the service **contract**.

## Project structure

- `core/` — `contracts` (source-of-truth types, TS + Python), `kernel` (registry,
  bus, arbiter, supervisor, lifecycle, config), `coordinator` (mediator + mode FSM).
- `services/` — one per concern, isolated. TS or Python. **Most work happens here.**
- `adapters/` — wrap hardware / external processes (camera, audio, input, ClawPilot MCP).
- `apps/shell/` — the Electron host (composition root).
- `tests/fixtures` — shared fakes; `tests/integration` — cross-cutting / IPC tests.

## Hard rules (do not violate)

1. A service depends on **`@aah/contracts` + the event bus only** — never import another service.
2. Every service ships a `requires` manifest **and** a `healthCheck()`.
3. **One language per service.** Two languages total in the repo (TS + Python); never add a third.
4. The seam between TS and Python is the **event bus / IPC** — never a direct call.
5. All cursor/keyboard injection goes through the shared **input multiplexer**.
6. Camera/mic leases are **released in `onDisable()`**.
7. Extend by **adding a service**, not by editing the kernel (Open/Closed).

## How to add a service

```bash
task new:service -- <id> ts   # or py
```

Then fill `requires` + the lifecycle + `healthCheck()`, and wire it into the shell
(in-process TS) or the IPC bridge (out-of-process). See `CONTRIBUTING.md`.

## Build / test / lint

```bash
task install   # pnpm install + uv sync
task build     # TS build
task test      # vitest + pytest
task lint      # eslint + ruff
```

## Conventions

- Branches are **layer-prefixed**: `service/<id>`, `adapter/<name>`, `core/<area>`,
  `shell/<area>`, `test/<area>`, `docs/<slug>`, `fix/<slug>`, `chore/<slug>`.
- TS: ESM, strict, private fields via `#`. Python: 3.11+, type-annotated, `ruff`-clean.
- Unit tests co-locate with source; cross-cutting tests live in `tests/integration`.
