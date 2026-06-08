# ADR 0070: npm publish — tsup build + dual (dev-src / publish-dist) exports

Status: Accepted
Date: 2026-05

## Context

The 10 `packages/*` libraries (+ `tools/shadow-registry`, a runtime dep of `@riftydev/npm-client`) are all `"private": true`, `"version": "0.0.0"`, with `main`/`module`/`types`/`exports` pointing at **raw TypeScript source** (`./src/index.ts`, `.ts`-extensioned imports). This makes the dev loop fast (Vite/Vitest transpile workspace `.ts` on the fly, HMR, no build step) but the packages **unpublishable/unconsumable**: `npm install @riftydev/x` would ship `.ts` files with `.ts` specifiers that Node/bundler resolution rejects.

Two goals in tension:

1. Packages **installable/usable standalone** from npm (compiled JS + `.d.ts`, correct `exports`, declared deps, public `access`).
2. **No dev-experience regression** (raw-TS workspace imports, HMR, no mandatory pre-`pnpm dev` build); change must not disturb the other agent's in-flight `main` work.

A publish-readiness audit (13-agent fan-out, this PR) confirmed the dependency graphs are already publish-clean (no missing/extraneous runtime deps, no `/internal/` leaks except the deliberate `@riftydev/vfs/internal`, no `solid-js`/`apps` imports). Blockers are purely packaging/build hygiene.

## Decision

### D1 — Build with `tsup` (new external dependency)

Each publishable package gets a `tsup.config.ts` bundling every public entry to **ESM + bundled `.d.ts`** in `dist/`. `tsup` (esbuild + rollup-plugin-dts) chosen over plain `tsc` because it inlines in-package `.ts` modules — transparently resolving the `.ts`-extension specifiers and `verbatimModuleSyntax` that block a naive `tsc` emit — while keeping first-party `@riftydev/*` (and external `acorn`/`sql.js`/`@xterm/*`) as **external** imports. A `@riftydev/vfs` spike verified ESM + `.d.ts` emit, the `./internal` subpath, and a Node `import` smoke of `dist/index.js`. `tsup` is the only new dependency (rule-2 IRREVERSIBLE).

### D2 — Dual exports: dev → `src`, publish → `dist`

In-repo `package.json` keeps `main`/`module`/`types`/`exports` → `./src/*.ts` (dev/workspace/HMR unchanged). A **`publishConfig`** block overrides them → `./dist/*` and sets `access: "public"`. pnpm applies `publishConfig` overrides only to the **published** manifest, so the tarball is correct while the working tree keeps the fast dev loop. Non-disruptive to in-flight `main` work because it is purely additive (`publishConfig`, `files`, `sideEffects`, `version`, `license`, `repository`, `build` script, `tsup.config.ts`) plus dropping `"private"`.

### D3 — Publish set = 11 packages (incl. `@riftydev/shadow-registry`)

The 10 `packages/*` libraries are published. `@riftydev/shadow-registry` (`tools/`) is **also published** — forced, not chosen: `@riftydev/npm-client` imports `bakedOverrides` from it at runtime (`src/overrides.ts`, ADR-0015), and a published package's runtime deps must resolve. Only its `.` (pure data) entry is published; the `./esbuild-binding` subpath (Node `fs` + ~20 MB vendored WASM, a playground/build-tool concern) is **dropped from published `exports`** (kept in dev `exports` for the playground). `apps/playground` stays `private`.

### D4 — Lockstep versioning at `0.1.0`; `workspace:*` deps, not peers

All 11 packages released **in lockstep**. `pnpm publish` rewrites `workspace:*` to the exact same version, keeping cross-package deps version-matched — which keeps shared singletons (`globalProcessManager` in kernel, `syncMirror` in vfs) a single instance when a consumer installs several `@riftydev/*` packages. Hence cross-package deps stay plain `dependencies` (lockstep-pinned), **not** `peerDependencies`: peers would burden consumers for no benefit while versions move in lockstep. If mixed-version consumption becomes real, revisit peers in a superseding ADR.

### D5 — `sideEffects` per-package, not blanket `false`

Leaf/pure packages (`io`, `vfs`, `npm-client`, `shell`, `terminal`, `shadow-registry`) get `"sideEffects": false`. Packages with import-time registration/bootstrap modules whitelist exactly those built files so a consumer's bundler can't drop them:

| Package | `sideEffects` whitelist |
|---|---|
| `@riftydev/net` | `["./dist/register-builtins.js", "./dist/sqlite/register-builtins.js"]` |
| `@riftydev/kernel` | `["./dist/worker-entry.js"]` |
| `@riftydev/runtime-js` | `["./dist/index.js", "./dist/worker.js"]` (`.` entry runs ~50 `registerBuiltin` calls) |
| `@riftydev/runtime-wasi` | `["./dist/worker-entry.js"]` |
| `@riftydev/service-worker` | `["./dist/sw.js"]` |

### D6 — Two additive public-API touch-ups

- `@riftydev/runtime-wasi` gains a `./worker-entry` subpath export (matching kernel/runtime-js/service-worker) so the WASI worker chunk is URL-resolvable standalone.
- `@riftydev/runtime-js` drops the **unused** `acorn-walk` dependency (only `acorn` is imported).

### D7 — Single source of truth + tag-driven release

`tools/publishing/sync-publish-config.mjs` (idempotent; `pnpm sync:publish`) holds the per-package spec and regenerates every `package.json` publish block + `tsup.config.ts`. CI publishes on a `v*` tag: build → set versions from tag → `pnpm publish` filtered to **`./packages/*` + `@riftydev/shadow-registry` only** (never a bare `pnpm -r publish`, which would also pick up the non-`private` integration fixtures). The `NPM_TOKEN` secret and the GitHub repo are manual, out-of-repo steps.

## Consequences

- (+) Each `@riftydev/*` package is independently `npm install`-able with correct ESM + types; "use it by parts" satisfied.
- (+) Dev loop, HMR, and the other agent's `main` work untouched (additive only).
- (+) `tsup` `external` keeps the package graph intact (no double-bundling of first-party deps; singletons preserved by D4).
- (−) New build dependency (`tsup`) and a `dist/` build step before publish.
- (−) `publishConfig.exports` override is a pnpm feature (`npm publish` alone wouldn't apply it) — the release path must use `pnpm publish`.
- (−) `@riftydev/shadow-registry` becomes public (was an internal tool) purely to satisfy `@riftydev/npm-client`'s runtime import.
- (follow-up) Per-package CHANGELOGs and a published browser-support matrix (`docs/compat/browsers.md`) remain TODO; README now documents consumer prerequisites (COOP/COEP, SAB, module Workers, service worker, WASM assets).

## Reversibility

IRREVERSIBLE (rule 1 — public package API/`exports` contract across packages; rule 2 — new external dependency `tsup`; rule 4 — touches >2 files). Recorded inline per ADR-0063/0064, build approach verified by the `@riftydev/vfs` spike before roll-out. Does not contradict an existing ADR; D6's subpath addition extends ADR-0018's "expanded subpath surface" rationale to `runtime-wasi`.

## References

- ADR-0001 (pnpm monorepo), ADR-0012 (`@riftydev/io` shared primitives), ADR-0015 (shadow-registry data tables — the `npm-client` runtime dep), ADR-0018 (runtime-js subpath exports — extended here to runtime-wasi), ADR-0002 (cross-origin isolation — the consumer prerequisite now in README).
- ADR-0063 / ADR-0064 (record-and-continue; verified-need).
- `tools/publishing/sync-publish-config.mjs` (the generator), `.github/workflows/release.yml`.
