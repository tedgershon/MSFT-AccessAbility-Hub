---
applyTo: "apps/shell/**,**/renderer/**,**/*.html,**/*.css"
---

# Shell & web UI rules

You are editing the **Electron shell / web UI** — the hub's only graphical surface and
the host for accessibility **tiles**. This is an accessibility product, so the UI
itself must be exemplary. Follow these without exception.

## Architecture

- **Renderer is pure browser code.** Never import from `electron` or Node in renderer /
  view code. The renderer talks to the main process ONLY through the typed `window.hub`
  bridge that the preload exposes (`apps/shell/src/preload.mts` →
  `apps/shell/src/ui/ipc-contract.ts`).
- **Keep logic out of the DOM.** Put pure, testable logic in view-model modules under
  `apps/shell/src/ui/*.ts` (e.g. `view-model.ts`); keep `renderer.ts` a thin DOM-painter
  that calls them. Co-locate vitest unit tests (`*.test.ts`) that run without a DOM.
- **One tile = one user-facing aid.** A tile toggles a service via `window.hub`
  (enable / disable). Never import or call a service directly from the UI — go through
  the bridge / event bus.

## Electron security (non-negotiable)

- Keep `contextIsolation: true` and `nodeIntegration: false`. The preload is the only
  code touching both Node/Electron and the page; it exposes a **small, typed** surface
  (`HubBridge`) over `ipcRenderer` — never expose `ipcRenderer`, `require`, or Node
  APIs to the page.
- Keep the **Content-Security-Policy** in `index.html` strict
  (`default-src 'self'; script-src 'self'`). Do not add remote origins, inline scripts,
  or `unsafe-eval`, and load no third-party scripts / fonts / CDNs.
- Treat everything crossing the IPC seam as untrusted input; validate shapes against the
  `ipc-contract` types.

## Visual design language (Azure Portal / Fluent)

- Model styling after the **Azure IoT Hub / Azure Portal** look — calm, dense,
  professional. **No Tailwind, no CSS frameworks, no generated utility-class soup.**
- Use the **CSS custom-property design tokens** already defined in `styles.css`
  (`--bg`, `--panel`, `--panel-border`, `--text`, `--muted`, `--accent`,
  `--healthy` / `--degraded` / `--unhealthy`). Add new tokens there rather than
  hard-coding colours / spacing.
- Plain semantic HTML with meaningful class names; styles live in `styles.css`, not in
  inline `style=` attributes (the CSP and the design system both depend on this).

## Accessibility baseline (dogfood it — WCAG 2.2 AA)

- Semantic landmarks (`header` / `main` / `section`) with `aria-labelledby` per panel;
  one `h1`, ordered headings.
- Every control has an accessible name, is keyboard-operable, and shows a **visible
  focus indicator**; focus order is logical.
- **Never rely on colour alone** — pair status colours (e.g. the health dots) with text,
  as the service rows already do.
- Maintain **AA contrast** (≥ 4.5:1 text, ≥ 3:1 large text / UI). Respect
  `prefers-reduced-motion` and `prefers-color-scheme`.
- Announce dynamic pushes (service / overlay / caption updates) to assistive tech via an
  appropriate live region.

## Before you finish

- `task build`, `task test`, and `task lint` pass. Use a `shell/<area>` branch
  (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).
- For a full accessibility pass run the **a11y-audit** prompt; to add a tile UI run the
  **new-tile** prompt (both in `.github/prompts/`).
