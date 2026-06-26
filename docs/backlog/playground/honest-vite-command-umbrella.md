---
area: playground
status: active
title: Umbrella — honest `vite` command (real CLI fidelity, no curated-shim drift)
created: 2026-06-26
why: `vite` is an owner-registered command dispatching to curated programmatic Vite-API handlers (configFile:false), not the real node_modules/.bin/vite CLI — honest at the subcommand level for V7 (ADR-0173) but residual fidelity gaps remain and could be silently declared "done" at the curated shim.
user_story: As a developer running `vite ...` in rifty, I want the command to behave like the real Vite CLI — my vite.config applied, unknown flags not silently dropped, ultimately the installed binary executing — but today it is a hand-curated dispatch over Vite's Node API with no user config and a silent dev-path arg drop.
sources: [ADR-0148, ADR-0173, ADR-0137, ADR-0150, ADR-0155, docs/backlog/shell/node-modules-bin-execution.md, docs/backlog/playground/vite8-production-build-preview.md]
code: [apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/workers/build-boot.ts, apps/playground/src/workers/owner-child-vite-command.ts]
---

## Context

**Umbrella item** — ties the narrower items into one capability and pins the north
star so a direct implementation cannot "finish" at a partial.

`vite` is registered as an owner shell command (`real-vite-bootstrap.ts:516`), NOT
resolved through `node_modules/.bin/vite`. It dispatches:

- bare `vite` / `vite dev` → `runDevServer` (real Vite dev server, co-resident child, ADR-0148)
- `vite build` → `runBuild` → `viteCommand.build(..., configFile:false)` (real Vite 7 Node API, ADR-0173)
- `vite preview` → `runPreview` (real, serves `dist/`)
- `vite optimize`, Vite 8 build/preview → **loud-rejected** (honest)

So the engine IS real Vite and the named subcommands ARE honest for V7. What is NOT
yet faithful — and must not be silently called done:

1. **Dev-path args silently dropped.** Only `build`/`preview`/`optimize` are matched;
   everything else (`vite --port 3000`, `vite --host`, `vite --mode x`, an unknown
   subcommand) falls to `runDevServer(ctx)`, which ignores args. `rejectUnsupportedViteArgs`
   guards build/preview only. → `honest-vite-dev-path-arg-honesty`.
2. **User `vite.config.*` not loaded.** `configFile: false` (`build-boot.ts:176/204`,
   ADR-0173) — plugins / resolve.alias / server.proxy / define in the user's config
   are ignored, no loud signal. ADR-0173 deferred config loading without a backlog
   record. → `honest-vite-config-file-loading`.
3. **Real binary bypassed.** `registerCommand('vite')` always wins over `.bin/vite`
   (ADR-0137 resolution order); the curated dispatch is a faithful-*behaviour* shim,
   not the real CLI. Mission = maximally faithful to real Node → north star is the
   installed binary executing. → `honest-vite-real-bin-dispatch`.

### North star + ordering (the anti-swerve guardrail)

Destination = `vite` executes the real `node_modules/.bin/vite` through the
node-entry loader, exactly like any other CLI; the curated handlers are an INTERIM.
Order: close silent gaps first (cheap, no infra) → config → real-bin dispatch (needs
ADR + engine work). **"Honest vite" is NOT done at the curated shim** — only when the
installed binary runs end-to-end OR every unsupported surface loud-throws. Declaring
victory after gaps 1+2 while the curated dispatch still stands is the exact swerve
this umbrella exists to prevent.

### Already honest / tracked elsewhere — do NOT re-open here

- V7 build/preview real — ADR-0173.
- `vite optimize` + Vite 8 build/preview loud-rejected — `playground/vite8-production-build-preview.md`,
  `playground/vite8-lightningcss-wasm-init.md`.
- `.bin` execution mechanism + worker-VFS transport — `shell/node-modules-bin-execution.md`
  (mechanism delivered ADR-0137; transport via owner-worker D / ADR-0150).

## Decomposition

- `playground/honest-vite-dev-path-arg-honesty` — gap 1: loud-reject unknown
  subcommands + unsupported dev flags (no silent drop). Smallest, no blockers.
- `playground/honest-vite-config-file-loading` — gap 2: load the real `vite.config.*`
  (or loud-throw when one exists we can't honor).
- `playground/honest-vite-real-bin-dispatch` — gap 3 / north star: resolve `vite`
  through `.bin/vite`, HMR + preview parity preserved; amends ADR-0148/0173 → needs ADR.

## Reversibility

REVERSIBLE as an umbrella. Child behavioural changes (loud-throw on previously-silent
input, dropping the `registerCommand('vite')` dispatch) may be IRREVERSIBLE per
`docs/process/decision-workflow.md` and need ADRs amending ADR-0148 / ADR-0173.
