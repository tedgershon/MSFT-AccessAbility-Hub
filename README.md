# AccessAbility Hub

A desktop accessibility hub: a single host application containing a dozen
self-contained accessibility services (eye-tracking, voice commands, OpenCV
pipelines, color-contrast correction, ClawPilot computer-use, etc.).

Each service can be toggled on/off independently, run alongside others, and is
isolated so that one service crashing never takes down the hub or the user's
control of their machine.

> This repository is a **scaffold**. The kernel, coordinator, contracts, services,
> and adapters expose their public shape and a minimal working core. Implementation
> detail beyond the basics is intentionally left as `// TODO`.

## Layout

The top level mirrors the architecture diagram: each layer is a sibling folder.

```
/apps/shell                TS + Electron host (toggle UI, status, mode-switch UI)
/core                      the layers the kernel itself depends on
  /kernel                  TS: registry, bus, arbiter, supervisor, lifecycle, config
  /coordinator             Mediator + mode state machines
  /contracts               Source-of-truth types -> TS + Python (+ JSON Schema)
/services                  one per disability concern, isolated
  /browser-ops             TS + Playwright
  /clawpilot               MCP server + skills
  /colorblind-contrast     TS (runs in shell)
  /flash-filter            TS (runs in shell)
  /eye-tracking            Python
  /voice-commands          Python
  /hand-signals            Python + FastAPI
/adapters                  wrap OpenCV / ClawPilot / camera / audio / input
  /camera /audio /input-injection /clawpilotMCP
/tests
  /fixtures                shared fakes (@aah/test-fixtures)
  /integration             cross-package / cross-language (IPC seam) tests
```

> Unit tests stay co-located with their source (`*.test.ts`, `test_*.py`); only
> tests that span packages or the TS↔Python seam live under `/tests`.

## Toolchain

- **TS side:** pnpm workspaces + Turborepo.
- **Python side:** uv workspace.
- **Root runner:** [Taskfile](./Taskfile.yml) sits on top of both.

```bash
task install   # pnpm install + uv sync
task build     # build TS side
task test      # TS + Python tests
task dev       # launch the hub shell
```

## Core rule

The kernel knows nothing about specific disabilities. It only knows the service
**contract** (`@aah/contracts`). Add a new service without touching the core.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow, **layer-prefixed** branch
naming, and the service rules. Scaffold a new service with
`task new:service -- <id> ts|py`.
