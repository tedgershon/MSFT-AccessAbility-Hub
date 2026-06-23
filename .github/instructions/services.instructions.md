---
applyTo: "services/**"
---

# Service rules

You are editing a **service** — one isolated accessibility concern. Follow these
without exception:

- **Isolation:** import from `@aah/contracts` and use the injected event bus only.
  Never import another service, the kernel internals, or another service's package.
- **One language** for the whole service (TS *or* Python, not both).
- **Declare `requires`:** list only the resources you actually touch, each as
  `(resource, mode)` where mode is `exclusive` (sole holder) or `shared` (co-exist).
  Under-declaring causes silent conflicts; over-declaring blocks compatible services.
- **Lifecycle:** implement `onLoad` (register, no side effects) → `onEnable` (acquire
  + start) → `onDisable` (stop + **release every lease**) → `onUnload`. Any camera or
  mic acquired in `onEnable` MUST be released in `onDisable`.
- **`healthCheck()`** must reflect real state — the supervisor restarts on `unhealthy`.
- **Input:** never drive the cursor/keyboard directly. Emit intent on the bus so the
  shared input multiplexer can serialize it.
- **Cross-process:** Python / external services talk to the kernel over the IPC seam,
  never via direct calls.

## Scaffolding

Prefer `task new:service -- <id> ts|py` over hand-copying. It wires the workspace and
substitutes name tokens.

## Tests

Co-locate unit tests (`*.test.ts` / `test_*.py`). Assert: the `requires` manifest is
correct, leases are released in `onDisable`, and `healthCheck()` tracks enabled state.
Use `@aah/test-fixtures` (TS) or the root `conftest.py` fixtures (Python).
