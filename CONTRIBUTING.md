# Contributing to AccessAbility Hub

Thanks for contributing! This repo is a microkernel hub of isolated accessibility
services. Most contributions are **new services**. This guide covers the workflow,
branch naming, and the rules that keep services isolated and the hub crash-safe.

## 1. Workflow

1. Create a **layer-prefixed** branch off `main` (see below).
2. Push it to the remote: `git push -u origin <branch>`.
3. Open a **PR to `main`**. Fill in the PR template (it includes the rules checklist).
4. CI must be green and you need **one review** before merge. Squash-merge.

## 2. Branch naming (layer-prefixed)

The prefix maps 1:1 to the top-level folder you're touching, so branches are
self-describing and reviews route by layer.

| Prefix            | Use for                                              | Example                          |
| ----------------- | ---------------------------------------------------- | -------------------------------- |
| `service/<id>`    | a new or changed accessibility service (most PRs)    | `service/eye-tracking`           |
| `adapter/<name>`  | adapter work (hardware / external process wrappers)  | `adapter/camera`                 |
| `core/<area>`     | kernel, coordinator, or contracts                    | `core/arbiter-lease-handoff`     |
| `shell/<area>`    | the hub shell app                                    | `shell/toggle-ui`                |
| `test/<area>`     | test-only changes                                    | `test/integration-ipc`           |
| `docs/<slug>`     | README, docs, architecture, comments                 | `docs/architecture-overview`     |
| `fix/<slug>`      | bug fixes spanning layers                            | `fix/supervisor-backoff`         |
| `chore/<slug>`    | tooling, CI, dependencies                            | `chore/bump-turbo`               |

> Architecture *proposals* that need sign-off before code follows may use
> `rfc/<slug>` instead of `docs/`.

Keep branches short-lived and one-contribution-each. Do **not** push to a shared
long-lived `services` / `core` branch — that creates contention and unreviewable PRs.

## 3. Adding a service (the common case)

Scaffold from the template instead of copying by hand:

```bash
task new:service -- eye-tracking ts     # or: py
# equivalently: pnpm new:service eye-tracking ts
```

This creates `services/eye-tracking`, substitutes the name tokens, and registers it
with the right workspace manager (pnpm for TS, uv for Python). Then:

1. Declare your `requires` capability manifest (only what you touch).
2. Implement the lifecycle (`onLoad`/`onEnable`/`onDisable`/`onUnload`) and `healthCheck()`.
3. TS in-shell services: install in [apps/shell/src/bootstrap.ts](apps/shell/src/bootstrap.ts).
   Out-of-process services (Python / MCP): wire to the kernel IPC bridge.
4. Add tests (see [TESTING.md](TESTING.md)).

## 4. The five rules (enforced in review)

1. A service depends on the **kernel contracts and the event bus only** — never import another service.
2. Every service ships a `requires` capability manifest **and** a `healthCheck()`.
3. **One language per service.**
4. Serialize all cursor/keyboard injection through the shared **input multiplexer** — no service drives the pointer directly.
5. Anything that reads a **camera or mic releases the lease in `onDisable()`**.

## 5. Local commands

```bash
task install   # pnpm install + uv sync
task build     # build the TS side
task test      # TS (vitest) + Python (pytest)
task lint      # eslint + ruff
```

## 6. CI

Every PR runs `.github/workflows/ci.yml`: build, typecheck, lint, and test for both
the TS and Python sides. Once a `pnpm-lock.yaml` / `uv.lock` is committed, CI will be
switched to frozen-lockfile installs — keep lockfiles up to date in your PR.
