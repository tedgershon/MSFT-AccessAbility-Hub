---
mode: agent
description: End-to-end design guide for building the AccessAbility Hub front-end — the tile-based home, its information architecture, visual language, customization, and MVP acceptance criteria. Follow this when designing or implementing the app UI.
---

# Designing the AccessAbility Hub UI

This is the design brief for the hub's front-end: a **tile-based launcher** for
accessibility services, styled after the Azure IoT Hub / Azure Portal. Follow it when
laying out the app, building the home screen, or adding UI around tiles.

> **Read first, don't repeat:** the engineering rules (pure renderer, `window.hub`
> bridge, strict CSP, design tokens, WCAG 2.2 AA baseline) live in
> [.github/instructions/shell.instructions.md](../instructions/shell.instructions.md)
> and are auto-applied to web files. This guide covers **design decisions** — IA,
> layout, visual language, customization — not those rules. To scaffold an individual
> tile use the **new-tile** prompt; to verify accessibility use the **a11y-audit** prompt.

---

## 1. What we're building

One desktop window: a **home grid of tiles**, where **one tile = one accessibility aid**
(the concrete tiles to render are listed in **§2 Tile catalog** below). A tile lets the
user understand an aid at a glance and **toggle it on/off**; the heavy lifting lives in
the backing service, reached only through `window.hub`. The UI never implements service
logic.

The product *is* an accessibility tool, so the interface must itself be a model of
clarity and inclusivity — calm, uncluttered, keyboard-first, and customizable.

---

## 2. Tile catalog — the data to render

The aids to surface, mirrored here so this prompt is **self-contained** (source of truth:
issue #1's pinned catalog + the `services/` tree — keep this in sync as tiles land). `id`
is the service id used with `window.hub`; ids marked *(provisional)* are not built yet.

| Tile | `id` | Group | Tag | Input | Status | What it does |
| --- | --- | --- | --- | --- | --- | --- |
| Color & Contrast | `colorblind-contrast` | Colour vision | color vision deficiency | screen | ✅ built | Real-time colour/contrast correction as a display overlay (deuteranopia / protanopia / tritanopia, low-contrast). |
| Live Captions | `live-captions` | Hearing | deaf & hard of hearing | microphone | ✅ built | System/mic audio → live captions + non-speech sound alerts; translation as a sub-toggle. |
| Conversation Coach | `conversation-coach` | Social / autism | autism | camera + microphone | ✅ built | On calls, watches camera + audio and privately surfaces repair prompts to the user. |
| Flash Filter | `flash-filter` | Photosensitivity | photosensitive epilepsy | screen | ✅ built | Detects seizure-triggering flashing and dims / filters it in real time. |
| Creative Studio | `creative-studio` | Vision | blind & low vision | screen + audio | ✅ built | Mediates creative apps for blind/low-vision users — narrates app state, automates steps. |
| Scene Describer | `scene-describer` *(provisional)* | Vision | blind & low vision | camera | 🚧 partial | Camera → scene/image understanding → spoken narration; snapshot-describe + point/gaze announce. |
| Simplify Text | `simplify-text` *(provisional)* | Cognitive | dyslexia, ADHD & cognitive | screen | 🚧 partial | Reads complex on-screen text and re-injects a simplified / restructured version in place. |
| Input Assist | `input-assist` *(provisional)* | Motor & dexterity | motor & dexterity | os-input | ⬜ planned | Cursor magnification / target-assist plus input remapping. |
| Privacy Guard | `privacy-guard` *(provisional)* | Vision | blind & low vision | camera / files | ⬜ planned | Scans images/screen before sharing and warns about private visual content. |

**Default grouping** (drives the §4 sections): **Vision** (Scene Describer, Privacy Guard,
Creative Studio) · **Colour vision** (Color & Contrast) · **Hearing** (Live Captions) ·
**Cognitive** (Simplify Text) · **Motor & dexterity** (Input Assist) · **Social / autism**
(Conversation Coach) · **Photosensitivity** (Flash Filter).

- **Render every tile, including planned ones**, in a "Setup needed / coming soon" state
  (§9) — don't hide them. Only `✅ built` tiles toggle live via `window.hub`.
- Don't hard-code this list in two places: per build-step 1 (§11), model it as the typed
  tile data the view-model consumes, seeded from these rows.

---

## 3. MVP — required (must ship)

These come straight from issue #1 and are non-negotiable acceptance criteria:

1. **Visually appealing and easy to understand** — a scannable tile grid, strong
   hierarchy, generous whitespace. A first-time user should grasp the screen in seconds.
2. **Supports visual customizations and applies them by default** — text size, theme
   (light/dark), high-contrast, and reduced-motion are first-class, applied on load (not
   buried in a settings page the user must hunt for).
3. **Persists style preferences across sessions** — store customization choices in
   `localStorage` and re-apply them on startup.
4. **Tools are encapsulated as clickable tiles** — every aid is a tile; the tile is the
   primary interaction unit.

Treat anything beyond these four as enhancement, not MVP.

---

## 4. Information architecture

```
┌ App header ──────────────────────────────────────────────┐
│  AccessAbility Hub        [ search ]  [ filter ▾ ]  [ Aa ] │   ← title · find · filter · customize
├──────────────────────────────────────────────────────────┤
│  Section: "Vision"          (impairment-tag group header) │
│   ▢ tile   ▢ tile   ▢ tile                                │
│  Section: "Hearing"                                       │
│   ▢ tile   ▢ tile                                         │
│  …                                                        │
└──────────────────────────────────────────────────────────┘
```

- **Home is the tile grid.** A responsive grid of equal-size tiles that wraps by
  available width (3-up on a wide window, collapsing to 1-up).
- **Group tiles by impairment category**, with a section header per group (Vision,
  Hearing, Motor & dexterity, Cognitive, Autism, Photosensitivity, …). This mirrors the
  Azure Portal's "Navigate / Tools" grouping and matches the impairment tags already in
  the catalog. Grouping is the default organizing principle; search/filter narrows it.
- **One control cluster in the header (top-right):** search, a tag filter, and a
  customization entry. Keep it to these three — resist a crowded toolbar.

---

## 5. Tile anatomy

Derived from the Azure "Features" cards (Fig A) and adapted for an on/off aid:

```
┌─────────────────────────────┐
│ ▣  (tinted rounded icon)    │   icon tile — category color, ~40px, rounded ~8px
│                             │
│ Live Captions               │   title — bold, high-contrast
│ Captions + sound alerts for │   description — 1–2 lines, muted secondary text
│ calls and media             │
│                             │
│ deaf & hard of hearing      │   impairment tag — subtle chip (also the search key)
│ ● healthy        [ Enable ] │   status (dot + TEXT) · primary toggle button
└─────────────────────────────┘
```

Rules for a tile:

- **Title + short description.** Description is one scannable sentence, not a paragraph.
- **Status is never colour-only.** Reuse the existing health pattern: a coloured dot
  **plus** a text label (`healthy` / `degraded` / `unhealthy`), driven by the service's
  `healthCheck()` snapshot pushed over `window.hub`.
- **Primary action is the toggle.** Label it by state (`Enable` / `Disable`); expose
  state to assistive tech (text or `aria-pressed`). Clicking calls
  `window.hub.enable(id)` / `disable(id)` — never the service directly.
- **Unavailable services degrade gracefully.** If a tile's backing service is missing a
  prerequisite (e.g. ClawPilot/Scout not installed, camera permission denied), show the
  tile in a disabled "Setup needed" state with a short reason and a link to setup — do
  **not** hide it. See §9.
- **The whole tile is a card**, not the toggle alone: white/surface fill, 1px subtle
  border, ~8–10px radius, soft shadow, generous padding (~16–20px). Uniform size across
  the grid.

---

## 6. Visual language (emulating the Azure references)

Key elements distilled from the two reference screenshots — emulate their **simplicity
and ease of use**:

- **Calm, generous whitespace.** Content breathes; nothing is crammed. This is the
  single biggest driver of the "easy to use" feel.
- **Clear three-step hierarchy:** small uppercase eyebrow / section label → bold
  heading → cards. Headings are confident and large; supporting text is quiet.
- **Uniform card grid.** Equal rectangular cards, light surface, hairline border,
  rounded corners, soft shadow, sitting on a slightly tinted neutral background.
- **Card = tinted icon tile + bold title + short muted description** (Fig A), optionally
  an inline link. Sections of **icon + label rows** for quick scanning (Fig B).
- **One restrained accent.** A single blue accent for icons, links, and interactive
  affordances only — never decorative colour. Secondary text is muted grey; titles are
  near-black (light theme) for contrast.
- **Recognition over recall:** every tile/section leads with an icon so users locate
  things by shape + colour, not by reading alone.

Implement these through the **CSS tokens in `styles.css`** (don't hard-code values).
The current shell ships a dark token set; add a **light "Azure" token set** and make
theme a customization (§7) so the default can match the reference look while honouring
`prefers-color-scheme`.

---

## 7. Customization & persistence (first-class, on by default)

Because this is an accessibility hub, presentation controls are a core feature, not a
preference pane afterthought. Provide at minimum:

| Control | Options | Applied as |
| --- | --- | --- |
| Text size | normal / large / x-large | root `font-size` / a `--text-scale` token |
| Theme | light (Azure) / dark / system | token set + `color-scheme` |
| Contrast | standard / high | high-contrast token overrides |
| Motion | full / reduced | gate animations on the setting + `prefers-reduced-motion` |
| Pinned tiles | user-pinned aids float to a "Pinned" section at top | render order |

- **Apply on load**, before first paint where possible, so the user never sees an
  un-styled flash. Read system preferences (`prefers-color-scheme`,
  `prefers-reduced-motion`) as the initial default, then let explicit choices win.
- **Persist to `localStorage`** and restore on startup (MVP requirement #3). Keep a
  single small, typed settings object; validate it on read.
- Keep the customization UI itself fully accessible (it's the one users with the
  greatest need will reach for first).

---

## 8. Onboarding, search & filtering

> I'm **overriding parts of the "Ideas" backlog** in issue #1 — see §10 for the why.

- **Lead with need, not role.** Replace the "I am a developer / user" split with a
  single friendly prompt — *"What do you want help with?"* — that maps to the impairment
  tags. The dev/user distinction adds little for end users and risks feeling othering.
- **Search by need.** A search box that matches tile titles, descriptions, and
  impairment tags (`adhd`, `low vision`, `dyslexia`, …). This is the primary way power
  users get to a tile fast.
- **Filter by tag** via the header filter control; default view is "all", grouped by
  category.
- **Rule-based filtering for MVP; AI-assisted curation later.** Predictable,
  inspectable, and accessible beats a magic re-ordering the user can't reason about.
  Leave a clean seam to add AI suggestions afterward.

---

## 9. Prerequisites & service availability

Some aids depend on external software (ClawPilot/Scout for MCP) or OS permissions
(camera, mic, input injection). Surface this honestly:

- Drive tile availability from the service's **`requires` manifest + `healthCheck()`**
  state coming over the bridge. A tile whose dependency is missing renders in a **"Setup
  needed"** state with a one-line reason and a path to resolve it.
- Provide a small **"Requirements / setup"** affordance (reachable from the header or an
  empty-state) listing prerequisites and permission status. Don't block the whole app on
  one missing dependency — isolate it to the affected tiles.

---

## 10. Decisions on the issue #1 "Ideas" (override log)

The "Ideas" in issue #1 are explicitly non-binding. Decisions for this design:

- **Adopt:** search by need; pinning; text-size / layout / colour-scheme customization;
  stating software prerequisites.
- **Change:** drop the **"I am a developer / user"** onboarding + dev/user filter in
  favour of **need-first** onboarding and impairment-tag filtering (§8). End users self-
  identify by need, not by developer-vs-user.
- **Defer:** **AI-driven tile customization/layout.** Ship rule-based, tag-driven
  filtering for MVP; revisit AI curation once the static experience is solid and
  measurable. Keep the data model clean so it can slot in later.

---

## 11. Suggested build order

Each step is independently shippable and testable (keep pure logic in view-models with
co-located vitest tests, per the shell instructions):

1. **Tile data + view-model** — model a tile (id, title, description, tags, icon, phase,
   health) and a pure `tilesViewModel(snapshot)` → grouped, filtered view. Unit-test it.
2. **Tile card + grid** — render one card (anatomy §5), then the responsive grouped grid.
3. **Toggle wiring** — enable/disable via `window.hub`; reflect health/phase live.
4. **Customization + persistence** — settings object, `localStorage`, apply-on-load,
   light/dark token sets.
5. **Search + tag filter** — header controls feeding the view-model.
6. **Availability/setup states** — prerequisite + permission handling (§9).
7. **Onboarding** — the "What do you want help with?" entry.
8. **a11y-audit pass** — run the **a11y-audit** prompt and fix everything it surfaces.

---

## 12. Definition of done (acceptance checklist)

- [ ] Home is a scannable, grouped grid of clickable tiles; one tile per aid.
- [ ] Each tile shows icon, title, short description, tag, colour-**and-text** status,
      and a state-labelled toggle wired through `window.hub`.
- [ ] Text size, theme, contrast, and motion are adjustable, **applied by default**, and
      **persist across sessions** via `localStorage`.
- [ ] Search + tag filtering work; default is grouped "all".
- [ ] Tiles with missing prerequisites show a graceful "Setup needed" state.
- [ ] Visual language matches the Azure references: whitespace, hierarchy, uniform
      cards, single restrained accent — built from `styles.css` tokens, no Tailwind.
- [ ] Passes the **a11y-audit** prompt (WCAG 2.2 AA) and `task build` / `task test` /
      `task lint`.

---

## References

- **Issue #1** — platform design, MVP requirements, and the pinned **tile catalog**
  comment (the live source of truth; a self-contained snapshot is mirrored in §2 so this
  prompt works without GitHub access).
- [.github/instructions/shell.instructions.md](../instructions/shell.instructions.md) —
  engineering rules (architecture, security, tokens, a11y baseline).
- **new-tile** and **a11y-audit** prompts in this folder.
