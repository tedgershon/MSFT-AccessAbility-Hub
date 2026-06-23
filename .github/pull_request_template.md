<!--
Branch name must be layer-prefixed, e.g. service/<id>, adapter/<name>,
core/<area>, shell/<area>, test/<area>, docs/<slug>, fix/<slug>, chore/<slug>.
See CONTRIBUTING.md.
-->

## What & why

<!-- One or two sentences. Link the issue if there is one. -->

## Type of change

- [ ] New service
- [ ] Adapter
- [ ] Core (kernel / coordinator / contracts)
- [ ] Shell
- [ ] Docs
- [ ] Fix / chore

## Contributor rules (delete rows that don't apply)

- [ ] Depends on **`@aah/contracts` + the event bus only** — does not import another service.
- [ ] Ships a `requires` capability manifest **and** a `healthCheck()`.
- [ ] **One language** for the whole service.
- [ ] All cursor/keyboard injection goes through the shared **input multiplexer** — nothing drives the pointer directly.
- [ ] Anything reading a **camera or mic releases the lease in `onDisable()`**.

## Checks

- [ ] `task build` / `task test` / `task lint` pass locally.
- [ ] Added or updated tests (unit co-located; cross-cutting under `tests/integration`).
