# ADR 0071: Umbrella `rifty` package — one-install front door (EPIC B)

Status: Accepted
Date: 2026-06

## Context

After ADR-0070 the 11 `@rifty/*` libraries are individually publishable, but a
consumer who just wants "rifty in my app" must `npm i` a fistful of scoped
packages and hand-wire the boot order themselves (cross-origin-isolation guard →
VFS backend → service worker → runtime worker), reproducing
`apps/playground/src/boot.ts` + `adapters/useRuntime.ts` without the Solid parts.

The distribution backlog (`docs/backlog-distribution-and-ide.md`, EPIC B) calls
for an **umbrella** front door with three layers, and records two directional
decisions this ADR now ratifies:

- **DD-2** — the umbrella is the **unscoped** name `rifty` (front-door brand,
  conventional à la `vite` + `@vitejs/*`; the name was free on npm, checked
  2026-06-02), a separate name claim beside the `@rifty` scope.
- **DD-1** — `@rifty/*` are never inlined into each other: `io`, `kernel`, `vfs`
  hold module singletons read/written across packages, so bundling duplicates
  state and silently breaks composition (ADR-0070 D4).

This is an IRREVERSIBLE step under the project checklist (new public package +
new public API surface + an npm name claim), hence this ADR.

## Decision

### D1 — New umbrella package `packages/rifty`, published as unscoped `rifty`

A twelfth publishable package. It is the topmost layer (above every `@rifty/*`,
peer to the playground but framework-free), so it introduces no reverse import.
The release filter `./packages/*` already covers it — no release-pipeline change
beyond registering it in the publish SPEC.

### D2 — Rename the workspace root package `rifty` → `rifty-workspace`

pnpm forbids two workspace projects sharing a name, and the root `package.json`
was named `rifty`. The root is `private` and never published, so its name is
immaterial; it is renamed `rifty-workspace` to free `rifty` for the published
umbrella. No script or `--filter` referenced the root by name (verified), so the
rename is inert.

### D3 — B1: subpath re-exports, kept external at build (DD-1)

One thin module per layer (`src/vfs.ts` = `export * from '@rifty/vfs'`, etc.),
mapped to subpaths `rifty/vfs · rifty/io · rifty/kernel · rifty/runtime`
(→ `@rifty/runtime-js`) `· rifty/wasi` (→ `@rifty/runtime-wasi`) `· rifty/net ·
rifty/npm-client · rifty/shell · rifty/terminal · rifty/service-worker`. tsup
keeps `@rifty/*` **external** (the shared `external: [/^@rifty\//]`), so the
built `dist/vfs.js` is literally `export * from '@rifty/vfs'`. Importing a layer
via `rifty/...` and via `@rifty/...` therefore resolves to the **same** singleton
instance — DD-1 honoured. `@rifty/shadow-registry` is **not** re-exported: it is
an internal data-table dependency of `@rifty/npm-client`, not a consumer surface.

### D4 — B2: `createSandbox(options, deps?)` façade — framework-free boot

A single async call runs the playground's boot order without DOM or Solid:
probe capabilities → (optionally) assert cross-origin isolation → bring up the
VFS backend (OPFS, falling back to memory) → (optionally) register the preview
service worker → `spawnRuntime`, returning a live `RuntimeController` plus boot
metadata (`vfs`, `capabilities`, `swError`) and `dispose()`. Degradations are
non-fatal and surfaced on the result, matching `bootstrapPlayground`. The
bundler-specific bits it **cannot** hide — the runtime `workerUrl` and the
`sw.js` asset URL — are inputs (the honest EPIC B limit; EPIC E owns the host
template that produces them). A `SandboxDeps` injection seam (mirroring
`boot.ts`) makes the pipeline unit-testable in Node without a Worker/OPFS/DOM.

The playground is **not** repointed onto `createSandbox` in this step: its
`boot.ts` carries DOM concerns a library must not (it paints a fatal banner into
`document.body`), and repointing risks the e2e suite for no publishing benefit.
The ~30 lines of overlap are deliberate; consolidating the playground onto the
umbrella is a follow-up (backlog C3), not a blocker.

### D5 — B3: `checkCapabilities()` wraps `detectCapabilities`

A re-surfaced `@rifty/runtime-js` `detectCapabilities()` so the umbrella is the
single import a consumer needs for the preflight gate. Pure, no side effects.

## Consequences

- Publish set grows 11 → 12. `docs/PUBLISHING.md` and the SPEC count are updated.
- The unscoped `rifty` name must be claimed on npm alongside the `@rifty` scope
  (backlog A2) — a manual, out-of-repo step.
- Subpath re-exports are zero-maintenance for type-only growth (`export *`), but
  a **new** scoped package or a new public subpath must be added here by hand;
  the publish SPEC is the single place that knows the umbrella's entry list.

## Alternatives considered

- **Scoped `@rifty/runtime` umbrella** — rejected per DD-2: the front door wants
  the bare brand name, and a scoped umbrella reads like just another layer.
- **Bundle the layers into one self-contained `rifty`** — rejected per DD-1:
  duplicates the cross-package singletons and breaks composition.
- **Repoint the playground onto `createSandbox` now** — deferred (D4): correct
  eventually (backlog C3), but out of scope for a publish-prep change and a
  needless risk to the e2e suite.
