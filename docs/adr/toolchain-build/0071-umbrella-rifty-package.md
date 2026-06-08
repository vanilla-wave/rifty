# ADR 0071: Umbrella `@riftydev/sdk` package — one-install front door (EPIC B)

Status: Accepted
Date: 2026-06

> **Name update (2026-06-03):** written for an **unscoped `rifty`** umbrella
> (DD-2). npm rejected `rifty` (403 — too similar to `sift`/`citty`/`pify`), so
> the umbrella ships **scoped as `@riftydev/sdk`**. Design unchanged; read
> "unscoped `rifty`" as "`@riftydev/sdk`".

## Context

After ADR-0070 the 11 `@riftydev/*` libraries are individually publishable, but
"rifty in my app" forces a consumer to `npm i` many scoped packages and hand-wire
the boot order (cross-origin-isolation guard → VFS → service worker → runtime
worker) — reimplementing `apps/playground/src/boot.ts` + `adapters/useRuntime.ts`
minus Solid.

`docs/backlog-distribution-and-ide.md` (EPIC B) calls for a three-layer
**umbrella** front door and records two decisions this ADR ratifies:

- **DD-2** — umbrella is the **unscoped** brand name `rifty` (à la `vite` +
  `@vitejs/*`; free on npm, checked 2026-06-02), claimed beside the `@riftydev`
  scope.
- **DD-1** — `@riftydev/*` are never inlined into each other: `io`/`kernel`/`vfs`
  hold module singletons read/written across packages, so bundling duplicates
  state and silently breaks composition (ADR-0070 D4).

IRREVERSIBLE (new public package + new public API + npm name claim).

## Decision

- **D1 — New package `packages/rifty`, published `@riftydev/sdk`.** Twelfth
  publishable package; topmost layer (above every `@riftydev/*`, peer to the
  playground but framework-free) → no reverse import. Release filter `./packages/*`
  covers it; only the publish SPEC needs it registered.
- **D2 — Rename workspace root `rifty` → `rifty-workspace`.** pnpm forbids two
  workspace projects sharing a name. Root is `private`/never published, so its
  name is immaterial; rename frees `rifty` for the umbrella. No script/`--filter`
  referenced it by name (verified) — inert.
- **D3 — B1: subpath re-exports, external at build (DD-1).** One thin module per
  layer (`src/vfs.ts` = `export * from '@riftydev/vfs'`, etc.), mapped to
  subpaths `@riftydev/sdk/vfs · /io · /kernel · /runtime` (→ `@riftydev/runtime-js`)
  `· /wasi` (→ `@riftydev/runtime-wasi`) `· /net · /npm-client · /shell · /terminal
  · /service-worker`. tsup keeps `@riftydev/*` **external** (shared
  `external: [/^@riftydev\//]`), so built `dist/vfs.js` is literally
  `export * from '@riftydev/vfs'` → a layer imported via `rifty/...` or
  `@riftydev/...` resolves to the **same** singleton (DD-1).
  `@riftydev/shadow-registry` is **not** re-exported — internal data-table dep of
  `@riftydev/npm-client`, not a consumer surface.
- **D4 — B2: `createSandbox(options, deps?)` façade — framework-free boot.** One
  async call runs the playground boot order sans DOM/Solid: probe capabilities →
  (opt.) assert cross-origin isolation → bring up VFS (OPFS, fallback memory) →
  (opt.) register preview service worker → `spawnRuntime`; returns a live
  `RuntimeController` + boot metadata (`vfs`, `capabilities`, `swError`) and
  `dispose()`. Degradations are non-fatal, surfaced on the result (matches
  `bootstrapPlayground`). Bundler-specific bits it **cannot** hide — runtime
  `workerUrl`, `sw.js` asset URL — are inputs (honest EPIC B limit; EPIC E owns
  the host template producing them). A `SandboxDeps` injection seam (mirrors
  `boot.ts`) makes the pipeline unit-testable in Node without Worker/OPFS/DOM.
  The playground is **not** repointed onto `createSandbox` here: its `boot.ts`
  carries DOM concerns a library must not (paints a fatal banner into
  `document.body`), and repointing risks the e2e suite for no publishing benefit.
  The ~30 lines of overlap are deliberate; consolidation is follow-up (backlog C3).
- **D5 — B3: `checkCapabilities()` wraps `detectCapabilities`.** Re-surfaces
  `@riftydev/runtime-js` `detectCapabilities()` so the umbrella is the single
  import for the preflight gate. Pure, no side effects.

## Consequences

- Publish set 11 → 12. `docs/PUBLISHING.md` and the SPEC count updated.
- `@riftydev/sdk` name must be claimed on npm beside the `@riftydev` scope
  (backlog A2) — manual, out-of-repo.
- Subpath re-exports are zero-maintenance for type-only growth (`export *`), but a
  new scoped package or public subpath must be added by hand; the publish SPEC is
  the single source of the umbrella's entry list.

## Alternatives considered

- **Scoped `@riftydev/runtime` umbrella** — rejected (DD-2): front door wants the
  bare brand; a scoped umbrella reads like just another layer.
- **Bundle layers into one self-contained `rifty`** — rejected (DD-1): duplicates
  cross-package singletons, breaks composition.
- **Repoint the playground onto `createSandbox` now** — deferred (D4): correct
  eventually (backlog C3), but out of scope for publish-prep and a needless e2e
  risk.
