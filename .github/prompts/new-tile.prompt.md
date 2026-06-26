---
mode: agent
description: Scaffold a new accessibility tile UI in the shell (view-model + view + styles + test), wired through window.hub.
---

# New tile (UI)

Add the front-end for an accessibility **tile** — the UI analog of `new-service`. The
tile surfaces and toggles a service; it never implements service logic itself.

## Steps

1. Confirm the backing **service** exists and is registered (in
   `apps/shell/src/bootstrap.ts` for in-process TS, or via the IPC bridge for
   out-of-process services). A tile drives a service through `window.hub` — if the
   service does not exist yet, run the **new-service** prompt first.
2. Put the tile's pure logic in a **view-model** module under `apps/shell/src/ui/`
   (state → view descriptor) with a co-located vitest test (`*.test.ts`) that runs
   without a DOM. Keep `renderer.ts` a thin painter that calls it.
3. Render with semantic HTML and the `styles.css` design tokens (Azure / Fluent look).
   No inline styles, no Tailwind.
4. Wire the tile's enable / disable through `window.hub` — never import the service
   package into the UI.
5. **Accessibility:** accessible name on every control, keyboard operable, visible
   focus, status not conveyed by colour alone, AA contrast. Run the **a11y-audit**
   prompt to confirm.
6. Keep the Electron invariants: strict CSP unchanged, `contextIsolation` /
   `nodeIntegration` untouched, preload surface minimal and typed.

## Rules

- Follow [.github/instructions/shell.instructions.md](../instructions/shell.instructions.md).
- Verify `task build`, `task test`, and `task lint`. Use a `shell/<area>` branch
  (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).
