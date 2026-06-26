# AccessAbility Hub

A desktop accessibility hub: a single host application containing a dozen
self-contained accessibility services (eye-tracking, voice commands, OpenCV
pipelines, color-contrast correction, ClawPilot computer-use, etc.).

Each service can be toggled on/off independently, run alongside others, and is
isolated so that one service crashing never takes down the hub or the user's
control of their machine.

> The kernel, coordinator, contracts, services, and adapters expose their public
> shape and are implemented. A few seams remain stubbed (`// TODO`) where they
> require OS-native hooks or external transports — notably input-injection and the
> ClawPilot MCP server.

## Layout

The top level mirrors the architecture diagram: each layer is a sibling folder.

```
/apps/shell                TS + Electron host (toggle UI, status, mode-switch UI)
/core                      the layers the kernel itself depends on
  /kernel                  TS: registry, bus, arbiter, supervisor, lifecycle, config
  /coordinator             Mediator + mode state machines
  /contracts               Source-of-truth types -> TS + Python (+ JSON Schema)
/services                  one per disability concern, isolated
  /adaptive-learning       TS
  /artinsight              TS
  /browser-ops             TS + Playwright
  /clawpilot               MCP server + skills
  /colorblind-contrast     TS (runs in shell)
  /conversation-coach      Python
  /creative-studio         TS
  /eye-tracking            Python
  /flash-filter            TS (runs in shell)
  /gaze-correlation        Python
  /gaze-dwell              Python
  /hand-signals            Python + FastAPI
  /input-personalization   TS
  /live-captions           Python (mic -> STT -> caption overlay)
  /pointing-magnifier      TS
  /voice-commands          Python
/adapters                  wrap OpenCV / ClawPilot / camera / audio / input
  /app-introspection /audio /audio-out /camera /clawpilotMCP
  /display-capture /input-injection /ipc /tts
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
