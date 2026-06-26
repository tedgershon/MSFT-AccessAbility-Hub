# Copilot instructions — AccessAbility Hub

Microkernel accessibility hub. The kernel only knows the service **contract**; add
features by adding services, never by editing the kernel.

**Always follow these rules:**

- A service depends on **`@aah/contracts` + the event bus only** — never import another service.
- Every service ships a `requires` capability manifest **and** a `healthCheck()`.
- **One language per service.** Only TS and Python exist — never introduce a third runtime.
- The TS↔Python seam is the **event bus / IPC** — never a direct function call across it.
- Serialize all cursor/keyboard injection through the shared **input multiplexer**.
- Release **camera/mic leases in `onDisable()`**.

**Where things live:** `core/` (contracts, kernel, coordinator), `services/` (most
work), `adapters/` (hardware/external wrappers), `apps/shell/` (Electron host),
`tests/fixtures` + `tests/integration`.

**Web / shell work:** the Electron UI in `apps/shell/` is governed by
`.github/instructions/shell.instructions.md` (auto-applied to web files) — pure
renderer + `window.hub` bridge, strict CSP, Azure/Fluent design tokens, WCAG 2.2 AA.
Invokable workflows live in `.github/prompts/`: **a11y-audit** (accessibility pass) and
**new-tile** (scaffold a tile UI).

**To add a service:** `task new:service -- <id> ts|py`, then implement `requires`,
the lifecycle hooks, and `healthCheck()`. Path-scoped rules live in
`.github/instructions/`.

**Before proposing a PR:** `task build`, `task test`, `task lint` should pass. Use
**layer-prefixed** branches: `service/<id>`, `adapter/<name>`, `core/<area>`,
`shell/<area>`, `test/<area>`, `docs/<slug>`, `fix/<slug>`, `chore/<slug>`.
