# Backlog — distribution, SDK & IDE kit

Separate from `PROJECT_PLAN.md`/`TASKS.md` (which track the **runtime** — milestones M0–M10+). This tracks **how rifty is consumed**: publishing, an umbrella SDK, headless UI controllers, a component kit, an IDE starter. Most is **optional / exploratory**.

A **pull backlog, not a plan**: no dates, no committed order beyond `depends-on` edges. Pull an item when it's worth doing.

- **IDs:** epic letter + number (`A1`, `C2`). Distinct from `D-`/`Q-`/`ADR-`/`M`.
- **Status:** `done` · `accepted` (direction agreed, not built) · `idea` · `deferred`.
- **Size:** S / M / L (rough).
- Promote a track's directional decision to a real **ADR** only when it starts (keeps the ADR log honest).
- Seed for GitHub Issues/Projects once published: 1 item → 1 issue, epics → labels/columns.

## Directional decisions (promote to ADR when the track starts)

- **DD-1 — No inlining of `@riftydev/*` into each other.** `io` (builtin registry), `kernel` (`globalProcessManager`), `vfs` (`syncMirror`) hold shared module singletons read/written across packages; bundling duplicates state and silently breaks composition. They stay `external` + lockstep-pinned (ADR-0070 D4).
- **DD-2 — Umbrella is `@riftydev/sdk`** (not `@riftydev/runtime`). Originally intended as the unscoped brand `rifty`, but npm rejected that name (403 — too similar to `sift`/`citty`/`pify`), so the umbrella ships scoped as `@riftydev/sdk` (no separate name claim; it lives in the `@riftydev` scope). **Ratified: ADR-0071** (EPIC B landed).
- **DD-3 — `@riftydev/workbench` (headless UI controllers) is justified now** — non-Solid consumers are foreseen. Makes the playground a thin shell and sharpens the D-002 boundary (solid-js stays in the binding layer only).
- **DD-4 — Component atoms are headless + themeable** (Radix/Headless-UI style: minimal markup + CSS-vars/slots, optional default theme), not batteries-styled.

## EPIC A — Publishing (ADR-0070 landed; follow-ups)

Build/publish pipeline done and verified (ADR-0070, `docs/PUBLISHING.md`). Remaining:

| ID | Item | Why | Size | Status |
|---|---|---|---|---|
| A1 | tsup build + `publishConfig` dual exports for 11 packages | consumable from npm | L | **done** (ADR-0070) |
| A2 | Claim `@riftydev` scope **and** `@riftydev/sdk` name on npm | publish + reserve brand | S | accepted (manual) |
| A3 | Create/push GitHub repo + per-package OIDC trusted publisher (no `NPM_TOKEN`) | tokenless tag-driven release | S | accepted (manual; `REPO_URL` fixed, release.yml on OIDC — ADR-0071) |
| A4 | Fix `apps/playground/build/sw-plugin.ts` swallowed by `.gitignore` (`build/`) | playground typecheck/CI red on fresh checkout | S | idea |
| A5 | Per-package `CHANGELOG.md` | DoD asks for it; only root + npm-client have one | M | idea |
| A6 | `docs/compat/browsers.md` (capability/browser matrix) | flagged "coming"; consumers need it | M | idea |
| A7 | Backfill ADR index rows 0066–0068 in `docs/adr/README.md` | index stale (stops at 0065) | S | idea |
| A8 | (opt) adopt `changesets` for versioning/changelogs | nicer release ergonomics | M | deferred |

## EPIC B — Umbrella `@riftydev/sdk` (one-install SDK)  ·  depends-on: A

The "front door". Three layers:

| ID | Item | Why | Size | Status |
|---|---|---|---|---|
| B1 | subpath re-exports (`@riftydev/sdk/vfs`, `@riftydev/sdk/runtime`, `@riftydev/sdk/net`, …) | one `npm i @riftydev/sdk` → all parts | S | **done** (ADR-0071) |
| B2 | `createSandbox()` façade — framework-free boot wiring | hide boot order + singleton wiring; consumer only passes worker/SW URLs | M | **done** (ADR-0071) |
| B3 | `checkCapabilities()` (wrap `detectCapabilities`) | preflight gate for consumer UI | S | **done** (ADR-0071) |

> Honest limit: B2 can't hide bundler-specific bits (worker URLs, `sw.js` build, WASM asset serving) — those land in EPIC E.

## EPIC C — `@riftydev/workbench` (headless UI controllers, L2)  ·  depends-on: B (loosely)

Lift the **already framework-agnostic** `apps/playground/src/glue/*` into a package (`sync-mirror-vfs`, `hmr-bridge`, `npm-shell-command`, `preview-bridge-wiring`, `devMode`, `registry-fetch`, …). DOM-aware but framework-free.

| ID | Item | Why | Size | Status |
|---|---|---|---|---|
| C1 | Move `glue/*` → `@riftydev/workbench`; verify no upward imports into playground | reuse logic across frameworks | M | accepted (DD-3) |
| C2 | Controller APIs: `createEditorSync`, `createPreviewBinding`, `createRuntimeSession` | stable headless contracts | M | accepted |
| C3 | Repoint playground `adapters/use*` to consume workbench | playground becomes a thin binding | M | idea |

## EPIC D — Framework bindings + atomic component kit (L3)  ·  depends-on: C

Compound components auto-wired via a context provider — drop-in atoms, you own layout/styling, no manual plumbing. `<RiftyIDE/>` = default layout over the atoms.

| ID | Item | Why | Size | Status |
|---|---|---|---|---|
| D1 | `@riftydev/solid`: `RiftyProvider` + atoms (`RiftyEditor`/`Terminal`/`Preview`/`CapabilitiesGate`/`RunButton`) | reuse existing playground components | M | accepted |
| D2 | `RiftyFileTree` (new — playground is ~single-file) | the one genuinely new atom (VFS-watch + tree) | M | idea |
| D3 | `<RiftyIDE/>` default-layout wrapper over atoms | lazy one-tag path | S | idea |
| D4 | Headless theming (CSS-vars/slots + default theme) — DD-4 | reusable look, not playground-bound | M | idea |
| D5 | `@riftydev/react` (and/or `@riftydev/vue`) atoms over the same workbench | non-Solid consumers (the reason for C) | L | idea |

## EPIC E — `create-rifty` starter template  ·  depends-on: B (+ D for the UI)

Host config that **cannot** be packaged into a library — only templated.

| ID | Item | Why | Size | Status |
|---|---|---|---|---|
| E1 | Vite template: COOP/COEP headers, module-worker config, `sw.js` build, WASM asset copy, worker URLs | un-packageable host wiring; one-command scaffold | M | idea |
| E2 | Bundle Monaco (or CodeMirror) integration + workers in the template | editor engine is heavy/host-specific | M | idea |
| E3 | `npm create rifty-app` shell + opinionated default IDE shell | "hosted IDE from a template" | L | idea |

## Dependency map

```
A (publish) ── B (umbrella/SDK) ── C (workbench) ── D (bindings + atoms) ── E3 (hosted shell)
                     └────────────────────────────── E1/E2 (template host config)
```

## "Ready IDE" spectrum (what each consumer actually needs)

- **Embeddable runtime SDK** (bring your own UI): B (+ A). ~closest.
- **Drop-in `<RiftyIDE/>` per framework**: + C + D.
- **Hosted IDE from a template**: + E.
