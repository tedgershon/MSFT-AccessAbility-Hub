---
mode: agent
description: Audit and fix a web/shell UI surface against WCAG 2.2 AA (semantics, keyboard, focus, ARIA, contrast, motion, live regions).
---

# Accessibility audit (WCAG 2.2 AA)

Audit a web / shell surface and fix what fails. This is an accessibility product — the
UI must meet the bar it ships to its own users.

## Scope

Target the file(s) named in the request; otherwise audit the shell renderer
(`apps/shell/renderer/*`) and its view-models (`apps/shell/src/ui/*`).

## Checklist (verify each; fix in place)

1. **Structure & semantics** — landmarks (`header` / `main` / `nav` / `section`), a
   single `h1`, ordered headings, lists for lists, native elements over ARIA-on-`div`.
2. **Name / role / value** — every control has an accessible name
   (label / `aria-label` / `aria-labelledby`); toggle buttons expose state
   (`aria-pressed` or text); decorative icons are `aria-hidden`.
3. **Keyboard** — everything operable without a mouse; logical focus order; no traps; a
   **visible focus** indicator on every focusable element.
4. **Colour & contrast** — text ≥ 4.5:1, large text / UI components ≥ 3:1; never
   colour-only — pair with text or shape (e.g. the health dots).
5. **Motion & preferences** — honour `prefers-reduced-motion`; respect
   `prefers-color-scheme`; nothing flashes > 3 Hz (we ship a Flash Filter — don't be the
   offender).
6. **Dynamic updates** — content pushed over `window.hub` (services, overlays, captions)
   is surfaced to assistive tech via a live region with appropriate politeness.
7. **Target size & spacing** — interactive targets ≥ 24×24 CSS px (WCAG 2.2).

## Constraints

- Stay within the shell rules: pure renderer, `window.hub` bridge only, strict CSP,
  design tokens in `styles.css`, no Tailwind. See
  [.github/instructions/shell.instructions.md](../instructions/shell.instructions.md).

## Verify & report

- `task build` and `task test` pass (view-model unit tests included).
- Report each issue found, the fix applied, and the WCAG success criterion it addresses.
