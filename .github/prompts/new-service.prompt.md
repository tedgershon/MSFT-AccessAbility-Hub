---
mode: agent
description: Scaffold and implement a new accessibility service from the template.
---

# New service

Create a new accessibility service end to end.

## Steps

1. Ask for (or infer from the request) the service **id** (kebab-case, e.g.
   `eye-tracking`) and **language** (`ts` or `py` — Python for vision/audio/CV, TS
   for browser/overlay/MCP-adjacent work).
2. Run `task new:service -- <id> <ts|py>` to scaffold `services/<id>` from the
   template. Do not hand-create the files.
3. Fill in the **`requires`** manifest — only the resources the service touches, each
   `(resource, mode)` with mode `exclusive` or `shared`.
4. Implement the lifecycle hooks and `healthCheck()`. Ensure any camera/mic acquired
   in `onEnable` is released in `onDisable`.
5. Wire it in: in-process TS services register in `apps/shell/src/bootstrap.ts`;
   out-of-process (Python / MCP) services attach via the kernel IPC bridge.
6. Add co-located unit tests using `@aah/test-fixtures` (TS) or the `conftest.py`
   fixtures (Python).
7. Verify `task build`, `task test`, and `task lint` pass.

## Rules (must hold)

- Depend on `@aah/contracts` + the event bus only — never import another service.
- One language for the whole service.
- Route all cursor/keyboard injection through the shared input multiplexer.

Use a `service/<id>` branch for the PR.
