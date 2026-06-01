# ADR 0069: npm publish — tsup build + dual (dev-src / publish-dist) exports

Status: Accepted
Date: 2026-05

## Context

The 10 `packages/*` libraries (+ `tools/shadow-registry`, a runtime dependency of
`@rifty/npm-client`) are all `"private": true`, `"version": "0.0.0"`, and ship
their `main`/`module`/`types`/`exports` pointed at **raw TypeScript source**
(`./src/index.ts`, with `.ts`-extensioned relative imports). That is exactly what
makes the in-repo dev loop fast — Vite/Vitest transpile workspace `.ts` on the fly,
HMR works, no build step — but it makes the packages **unpublishable and
unconsumable** from npm: a fresh `npm install @rifty/x` would deliver `.ts` files
with `.ts` import specifiers that standard Node/bundler resolution rejects.

The goal (publish prep) is twofold and in tension:

1. Packages must be **installable and usable standalone** from npm (compiled JS +
   `.d.ts`, correct `exports`, declared deps, public `access`).
2. The **existing dev experience must not regress** (raw-TS workspace imports, HMR,
   no mandatory build before `pnpm dev`), and the change must not disturb the other
   agent's in-flight `main` work.

A publish-readiness audit (13-agent fan-out, recorded in this PR) confirmed the
dependency graphs are already publish-clean (no missing/extraneous runtime deps, no
`/internal/` leaks except the deliberate `@rifty/vfs/internal`, no `solid-js`/`apps`
imports). The blockers are entirely packaging/build hygiene.

## Decision

### D1 — Build with `tsup` (new external dependency)

Each publishable package gets a `tsup.config.ts` that bundles every public entry to
**ESM + a bundled `.d.ts`** in `dist/`. `tsup` (esbuild for JS, rollup-plugin-dts for
declarations) was chosen over plain `tsc` because it inlines the in-package `.ts`
modules — which transparently resolves the `.ts`-extension import specifiers and
`verbatimModuleSyntax` that block a naive `tsc` emit — while keeping first-party
`@rifty/*` (and external `acorn`/`sql.js`/`@xterm/*`) as **external** imports. A
spike on `@rifty/vfs` verified ESM + `.d.ts` emit, the `./internal` subpath, and a
Node `import` smoke of the built `dist/index.js` all work. `tsup` is the only new
dependency (rule-2 IRREVERSIBLE).

### D2 — Dual exports: dev points at `src`, publish points at `dist`

The in-repo `package.json` keeps `main`/`module`/`types`/`exports` → `./src/*.ts`
(dev/workspace/HMR unchanged). A **`publishConfig`** block overrides
`main`/`module`/`types`/`exports` → `./dist/*` and sets `access: "public"`. pnpm
applies `publishConfig` field overrides only to the **published** manifest, so the
tarball is correct while the working tree keeps the fast dev loop. This is why the
change is non-disruptive to in-flight `main` work: it is purely additive
(`publishConfig`, `files`, `sideEffects`, `version`, `license`, `repository`, a
`build` script, `tsup.config.ts`) plus dropping `"private"`.

### D3 — Publish set = 11 packages (incl. `@rifty/shadow-registry`)

The 10 `packages/*` libraries are published. `@rifty/shadow-registry` (in `tools/`)
is **also published** — not by choice but because `@rifty/npm-client` imports
`bakedOverrides` from it at runtime (`src/overrides.ts`, ADR-0015); a published
package's runtime deps must themselves resolve. Only its `.` (pure data) entry is
published; the `./esbuild-binding` subpath (Node `fs` + a ~20 MB vendored WASM, a
playground/build-tool concern) is **dropped from the published `exports`** (kept in
the dev `exports` for the playground). `apps/playground` stays `private`.

### D4 — Lockstep versioning at `0.1.0`; `workspace:*` deps; not peers

All 11 packages are versioned and released **in lockstep**. `pnpm publish` rewrites
`workspace:*` to the exact same version, so cross-package deps stay
version-matched — which is what keeps the shared singletons (`globalProcessManager`
in kernel, `syncMirror` in vfs) a single instance for a consumer who installs
several `@rifty/*` packages. For that reason the cross-package deps are kept as plain
`dependencies` (lockstep-pinned), **not** `peerDependencies`: peers would push the
install burden onto consumers for no benefit while versions move in lockstep. If
mixed-version consumption ever becomes a real scenario, revisit peers in a
superseding ADR.

### D5 — `sideEffects` is per-package, not a blanket `false`

Tree-shaking safety: leaf/pure packages (`io`, `vfs`, `npm-client`, `shell`,
`terminal`, `shadow-registry`) get `"sideEffects": false`. Packages with import-time
registration/bootstrap modules whitelist exactly those built files, so a consumer's
bundler can never drop them:

- `@rifty/net` → `["./dist/register-builtins.js", "./dist/sqlite/register-builtins.js"]`
- `@rifty/kernel` → `["./dist/worker-entry.js"]`
- `@rifty/runtime-js` → `["./dist/index.js", "./dist/worker.js"]` (its `.` entry runs ~50 `registerBuiltin` calls)
- `@rifty/runtime-wasi` → `["./dist/worker-entry.js"]`
- `@rifty/service-worker` → `["./dist/sw.js"]`

### D6 — Two additive public-API touch-ups

- `@rifty/runtime-wasi` gains a `./worker-entry` subpath export (matching the
  worker-entry pattern already used by kernel/runtime-js/service-worker) so the WASI
  worker chunk is resolvable by URL standalone.
- `@rifty/runtime-js` drops the **unused** `acorn-walk` dependency (only `acorn` is
  imported).

### D7 — Single source of truth + tag-driven release

`tools/publishing/sync-publish-config.mjs` (idempotent; `pnpm sync:publish`) holds
the per-package spec and regenerates every `package.json` publish block +
`tsup.config.ts`. CI publishes on a `v*` tag: build → set versions from the tag →
`pnpm publish` filtered to **`./packages/*` + `@rifty/shadow-registry` only** (never a
bare `pnpm -r publish`, which would also pick up the non-`private` integration
fixtures). The `NPM_TOKEN` secret and the GitHub repo are manual, out-of-repo steps.

## Consequences

- (+) Each `@rifty/*` package is independently `npm install`-able with correct
  ESM + types; "use it by parts" is satisfied.
- (+) Dev loop, HMR, and the other agent's `main` work are untouched (additive only).
- (+) `tsup` `external` keeps the package graph intact (no double-bundling of
  first-party deps; singletons preserved by D4).
- (−) New build dependency (`tsup`) and a `dist/` build step before publish.
- (−) `publishConfig.exports` override is a pnpm feature (`npm publish` alone would
  not apply it) — the release path must use `pnpm publish`.
- (−) `@rifty/shadow-registry` becomes a public package (was an internal tool) purely
  to satisfy `@rifty/npm-client`'s runtime import.
- (follow-up) Per-package CHANGELOGs and a published browser-support matrix
  (`docs/compat/browsers.md`) remain TODO; README now documents the consumer
  prerequisites (COOP/COEP, SAB, module Workers, service worker, WASM assets).

## Reversibility

IRREVERSIBLE (rule 1 — public package API/`exports` contract across packages; rule 2
— new external dependency `tsup`; rule 4 — touches >2 files). Recorded inline per
ADR-0063/0064 with the build approach verified by the `@rifty/vfs` spike before
roll-out. Does not contradict an existing ADR; D6's subpath addition extends
ADR-0018's "expanded subpath surface" rationale to `runtime-wasi`.

## References

- ADR-0001 (pnpm monorepo), ADR-0012 (`@rifty/io` shared primitives),
  ADR-0015 (shadow-registry data tables — the `npm-client` runtime dep),
  ADR-0018 (runtime-js subpath exports — extended here to runtime-wasi),
  ADR-0002 (cross-origin isolation — the consumer prerequisite now in README).
- ADR-0063 / ADR-0064 (record-and-continue; verified-need).
- `tools/publishing/sync-publish-config.mjs` (the generator), `.github/workflows/release.yml`.
