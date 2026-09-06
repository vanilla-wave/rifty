---
area: distribution
status: draft
title: Published sdk main and sw bundles carry only executed code — statement-level side-effect-free io root, generic-only vfs import, src worker entries marked side-effectful
created: 2026-09-06
why: published @riftydev/io is one dist file whose top-level Buffer/Stream installs keep all 48 KB alive for any single import, so sw.js weighs 62 KB instead of 13 and sdk main 101 instead of 57; sandbox.ts imports initBackend even in toolchain mode; workbench sideEffects omits the src no-COI worker entry.
user_story: As a host shipping the no-COI sandbox from npm, I want the service worker and page bundle to carry only what they run, but today each carries the whole io Buffer/streams module for one error class and two path helpers.
sources: [ADR-0172, ADR-0070, ADR-0352, docs/backlog/toolchain-build/worker-bundle-shared-runtime-dedup.md, docs/backlog/playground/e2e-prod-build-coverage.md, docs/backlog/distribution/reference/no-coi-client-bundle-evidence.md]
code: [packages/io/package.json, packages/io/src/index.ts, packages/io/src/buffer.ts, packages/io/src/streams/readable.ts, packages/service-worker/src/body-transport.ts, packages/service-worker/src/preview-bridge.ts, packages/service-worker/src/route-preview.ts, packages/net/src/cross-realm/preview-port.ts, packages/runtime-js/src/host.ts, packages/rifty/src/sandbox.ts, packages/workbench/package.json]
---

## Context

Three packaging facts, all invisible on workspace source and visible only on
`publishConfig` dist (evidence doc):

1. `@riftydev/io` declares `sideEffects: false`, but its dist is a single
   file with ~11 impure top-level sites — `installCoreMethods(Buffer)` /
   `installIntMethods` / `installExtraMethods` (`buffer.ts:403-405`), the
   Buffer brand, `Object.setPrototypeOf(Stream…)`, EventEmitter prototype
   wiring, `makeCallableStreamConstructor` consts, `getOwnPropertyDescriptor`
   consts. Bundlers drop whole modules, not statements inside one: `import
   { NotImplementedError } from '@riftydev/io'` costs 48.2 KB min. sw imports
   `parsePreviewPath`, `synthesizePreviewUrl`, `NotImplementedError`; sdk main
   reaches it through `runtime-js/host.ts` and `net/cross-realm/preview-port.ts`;
   net and kernel dist chunks import `{ EventEmitter, Readable, Buffer }` from
   the root. sw: 13 → 62 KB min (5 → 18 gz); sdk main: 57 → 101 KB min
   (17 → 29 gz).
2. `sandbox.ts` statically imports `initBackend` from `@riftydev/vfs`; vfs
   tree-shakes per export (`normalizePath`-only 6 KB vs `initBackend` 28 KB on
   dist), and toolchain mode never calls it.
3. `packages/workbench/package.json` `sideEffects` lists
   `./src/workers/kernel-worker-entry.ts` and `./dist/no-coi-toolchain-worker.js`,
   not `./src/workers/no-coi-toolchain-worker.ts`. No in-repo consumer takes
   the wrapper-`import` route on source (tests use `/@fs` URLs and
   `?worker&url`; the packed fixture runs on dist, which is listed); a
   generator-level fix rides along, not a shipped-bundle bug.

Sizing against the whole: ≈ 97 KB min / ≈ 25 KB gz total (sw 18 → 5 gz, main
29 → 17 gz) against a first no-COI load of ≈ 1.58 MB gz today — ≈ 1.6%; the
sw is fetched once and never gates boot. Value is relative: after the
sibling worker items land, sw and main are the only artifacts left carrying
dead code.

Sibling roots: `toolchain-build/worker-bundle-shared-runtime-dedup` (Buffer
class duplicated per worker chunk) and `playground/e2e-prod-build-coverage`
(prod-only divergence invisible to dev e2e).

## Challenge

challenge: 2026-09-06 — 5 problems
- BLOCKING: a materially cheaper direct route reaches the same value — make the `@riftydev/io` root honest instead of adding public subpaths: the retention is ~11 top-level impure sites in one package (Buffer install+brand → factory, `Stream` setPrototypeOf, `EventEmitter` prototype wiring, 5 `makeCallableStreamConstructor` consts, 3 `Object.getOwnPropertyDescriptor` consts); `/* @__PURE__ */`-ing them (emulated in-memory on the packed `io/dist/index.js`) drops `import { NotImplementedError }` 48.2 → 3.2 KB and the sw trio → 3.5 KB, esbuild/tsup already carry the annotation to consumers (io dist holds 21 today). Same sw/sdk-main numbers, no IRREVERSIBLE subpath ADR, no `sync-publish-config` regen, no 5 consumer import rewrites, `sideEffects: false` stops being a lie, and every other root importer benefits (`net/dist/chunk-6HGIE5YZ.js` and kernel chunks import `{EventEmitter, Readable, Buffer}` from root). Out-of-scope only rejects "splitting the root"; making it tree-shakeable is never weighed.
- Impact never sized against the whole; no user feels it materially: total win ≈ 97 KB min / ~25 KB gz (sw 18→5, main 29→17 gz) against a no-COI first load of ≈ 1.58 MB gz (worker 1297 + QuickJS wasm 232 per boot + main + sw, evidence doc) ≈ 1.6%; the sw is fetched once and never gates boot. Sibling `runtime-js/lazy-typescript-tsconfig-discovery` owns 77% and `distribution/no-coi-worker-install-lazy-split` 18%; the doc quotes absolute deltas only, carries no M11 tag, names no host (epic already records adopter-share unsized) and states no opportunity-cost comparison.
- RED half is already green: the `INSPECT_MAX_BYTES` marker lives only in `setInspectMaxBytes` error strings (`io/dist/index.js:993,1000`), an unused export tree-shaken today — current sw and sdk-main dist bundles contain the whole io module yet no marker (verified with a dist-resolved esbuild build). Only the `io/dist/index.js`-input assertion is a real RED.
- Decision 2 is bundler-conditional and unstated: vfs per-export tree-shakes already (`normalizePath`-only = 6.0 KB vs `initBackend` 28.2 KB on dist), so the lazy `import('@riftydev/vfs')` saves ≈ 22 KB only where the host splits dynamic imports (Vite, esbuild `splitting: true`); esbuild without `splitting` inlines it → 0 saving; the doc should name the condition and the packed fixture as the proof lane.
- Item 3 has no current victim: every in-repo consumer takes an entry route that keeps side effects regardless (`workbench-vite-consumer` `?worker&amp;url`, `tests/no-coi/*` `/@fs` URL; evidence run via `entryPoints` = 4506 KB), and the only wrapper `import '@riftydev/workbench/no-coi-toolchain-worker'` consumer (`no-coi-packed-toolchain-consumer/src/worker.ts`) runs on dist, which is listed. A one-line generator fix is fine to ride along, but its RED tests a route nobody takes and should not be framed as a shipped-bundle bug.

## Out of scope

- Buffer class identity across worker chunks — stays with
  `worker-bundle-shared-runtime-dedup`.
- A prod-build e2e lane — stays with `e2e-prod-build-coverage`.
- New public subpaths on `@riftydev/io`; the root export keeps its shape.

## Decisions

- 2026-09-06 — agent carrier (after challenge, closes the BLOCKING line):
  make the `@riftydev/io` root statement-level side-effect-free — the ~11
  impure top-level sites become `/* @__PURE__ */`-annotated or factory-wrapped
  so `sideEffects: false` holds; no subpaths, no ADR, no consumer import
  rewrite; every root importer (sw, sdk main, net and kernel chunks) benefits.
  Critic emulation: `import { NotImplementedError }` 48.2 → 3.2 KB.
- rejected route: side-effect-free subpaths `@riftydev/io/errors` +
  `/preview-protocol` (agent's first carrier) — dearer for the same bytes:
  IRREVERSIBLE public surface, `publishConfig` regen, five import rewrites.
- 2026-09-06 — agent carrier: `sandbox.ts` reaches `initBackend` via
  `import('@riftydev/vfs')` inside the generic branch only; saves ≈ 22 KB
  only under a splitting bundler (documented host path); proof lane = packed
  fixture.
- 2026-09-06 — agent carrier: workbench `sideEffects` lists every
  `./src/workers/*` worker entry beside its dist twin — generator-level
  hygiene, no RED of its own.
- RED targets: esbuild metafile over packed dist with `splitting: true` — bytes
  attributed to `io/dist/index.js` in sw and in sdk main ≤ 5 KB (today 48);
  packed-consumer test stays green.
- Reversibility: REVERSIBLE — annotations and import placement.
