---
area: npm-client
status: draft
title: sass-embedded@1.100.0 via synthesized facade — second substitution, seam proof
created: 2026-07-23
why: real Vite SCSS projects pin sass-embedded, whose dart platform binary cannot run in the browser; ADR-0310's spike proved the exact pure-JS sass twin matches every surface Vite and direct consumers touch, so Sass ships as the registry's second substitution and proves the seam is package-generic
epic: honest-shadow-substitutions
blocked_by: [npm-client/shadow-recipe-v2-dependency-projection-execution]
sources: [ADR-0310, ADR-0335, docs/backlog/npm-client/reference/sass-1.100-node-selector-probe.md]
---

## Context

Slice `sass-scale-proof` (see epic §Budget). Carrier decided by ADR-0310
(Pattern 1: immutable synthesized `sass-embedded@1.100.0` facade over the
exact upstream pure-JS `sass@1.100.0` twin; finite adapted divergence list;
no runtime assets/MessagePort/adapter). The PR is deliberately constrained to
package-specific files so review can see whether the seam is real.

## Readiness blockers

- Commit the complete Node v24.16.0
  `sass@1.100.0`/`sass-embedded@1.100.0` differential command, exact output,
  package identities, and timeout/deadlock procedure behind all nine parity
  rows. ADR-0310's summary and the selector-only probe are not the artifact.
- Close every row in the Fault matrix below with a reachable proof target after
  the recipe-v2 dependency-projection execution contract becomes ready.

## Acceptance

- Fresh/replay/snapshot and applicable general-Eddy materialization retain the
  exact substitution marker and acquisition provenance.
- Zero `sass-embedded` platform binary/optional packages fetched; the exact
  `sass@1.100.0` twin and its dependencies are recorded; no runtime-asset
  capability is created and zero manager/store operations run.
- Direct guest CJS `require('sass-embedded')` and ESM
  `import('sass-embedded')` probes match the finite Node oracle from the
  ADR-0310 differential suite, including lifecycle
  (initCompiler/initAsyncCompiler, two compilations, dispose, post-dispose
  error texts), sync+async importers, logger warn/deprecation, sourceMap
  bytes, error `sassMessage`/span/message shape, synthesized `info`.
- Real Vite 7.3.6 SCSS project: nested partial and Vite-resolved `@use`,
  custom importer, a warning, source map; dev renders exact normalized CSS,
  an edit HMRs, build emits matching CSS/map/dependency facts.
- The named divergence (sync compile + async importer: loud throw where real
  sass-embedded deadlocks) is a compat ⚠ note with a differential test
  pinning BOTH behaviors.
- Unsupported versions, CLI/bin, and every unproven legacy/API surface are
  explicit compat ❌ with named `NotImplementedError('sass-embedded.<gap>')`
  throws.
- Budget carries a measured cold-install delta row (bytes + wall time for the
  twin) through the perf harness, committed as matched evidence like the
  esbuild rows; the gate is honest recording, not a threshold.
- Seam gate: a repository check lists generic files this slice is forbidden to
  modify (generic planner, manager/store, MessagePort, package-tree authority,
  owner/VFS/bootstrap/kernel path, runtime-js, esbuild adapter). Needing any
  of them means the seam failed — return to decision review, do not patch.

## Parity cases

Oracle: real Node v24.16.0 `sass-embedded@1.100.0`. Enumerated from the
ADR-0310 spike; each is a differential test:

1. CJS/ESM export shape (cleaned namespace; no dart2js dead keys).
2. `compileString`/`compileStringAsync` css + `loadedUrls` + absent sourceMap.
3. `sourceMap: true` + `sourceMapIncludeSources: true` byte-identical map.
4. Compiler lifecycle: two compiles, dispose, post-dispose sync/async error
   texts (`Compiler caused error: Sync|Async compiler has already been
   disposed.`).
5. Modern importer sync + async incl. `containingUrl`; `loadedUrls` content.
6. Logger: `@warn` call shape; `slash-div` deprecation id + span.
7. Errors: `expected "}".` and missing-@use — `Error: `-prefixed message,
   sassMessage, span start/end/text, `span.url: undefined`.
8. `info === "sass-embedded\t1.100.0"`.
9. Legacy `renderSync` output + stats keys + legacy-js-api deprecation.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | drifted recipe, dependency projection, facade bytes, bin target, or provenance rejects before publish/reuse | catalog/installer mutation table |
| observable-order | unsupported version/CLI rejects before rejected-package acquisition or writes; importer/logger lifecycle matches the pinned Node order | ordered install + differential ledgers |
| provenance-lie | fresh/replay/snapshot preserve exact Sass/twin identities and never substitute native or host bytes | fresh→replay→snapshot differential |
| unbounded-read / corrupt-input / provenance-lie | stalled, partial, corrupt, or failed registry/tarball acquisition publishes no facade, bin, success report, or lock; retry materializes exact bytes | acquisition boundary faults + retry |
| torn-state | abort during facade/bin writes publishes no lock/success; retry reconciles the exact tree | materialization abort fault |
| quota-perm-fail | facade/bin write rejection remains loud and publishes no lock/success | VFS fault matrix |
| sibling-drift | direct CJS/ESM and Vite dev/HMR/build share one recipe/facade and adapted-divergence table | full acceptance cross-product |

## Out of scope

- `sass-embedded` versions other than 1.100.0 and any version range —
  `NotImplementedError('sass-embedded.version')` + compat ❌.
- The `sass` CLI/bin — `NotImplementedError('sass-embedded.cli')` + compat ❌.
- Watch mode / `@parcel/watcher` surface.
- A Sass runtime-asset adapter or any no-op Workbench adapter to fake N=2 on
  the runtime-asset seam (forbidden by ADR-0310).

## Decisions

- ADR-0310 owns the carrier and the adapted-divergence list.
- ADR-0335 owns the recipe/materialization model this slice instantiates.
- The pinned Sass 1.100.0 selector probe proves `process.versions.node` is the
  Node-path selector; `process.release` is not a prerequisite.
- Delete-on-done with the sass-scale-proof PR; epic closure requires this
  slice (not optional downstream).
