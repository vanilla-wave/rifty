---
area: npm-client
status: draft
title: sass-embedded@1.100.0 via synthesized facade — second substitution, seam proof
created: 2026-07-23
why: real Vite SCSS projects pin sass-embedded, whose Dart platform binary cannot run in the browser; the exact pure-JS Sass twin matches the named compile and Vite surfaces but not invalid-construction process liveness, so this second substitution remains the package-generic seam proof only after that observable fork is refined
epic: honest-shadow-substitutions
sources: [ADR-0310, ADR-0335, docs/backlog/npm-client/reference/sass-1.100-node-selector-probe.md, docs/backlog/npm-client/reference/sass-1.100.0-packument.md, docs/backlog/npm-client/reference/sass-1.100.0-node-differential.md, docs/backlog/npm-client/reference/sass-constructor-liveness-post-pickup-fork.md]
---

## Context

Slice `sass-scale-proof` (see epic §Budget). Carrier decided by ADR-0310
(Pattern 1: immutable synthesized `sass-embedded@1.100.0` facade over the
exact upstream pure-JS `sass@1.100.0` twin; finite adapted divergence list;
no runtime assets/MessagePort/adapter). The PR is deliberately constrained to
Sass-owned recognition and facade files plus the smallest data-driven generic
catalog, registry-source, installer, and provenance seams needed to execute a
second real recipe. Generic code never recognizes a Sass package name.

## Post-pickup lifecycle fork

The autonomous attempt reached ready at `171f62f86fbb3fefff856a5a71cb4cda209a0e1c`
and product head `9618ab31f0d758e5836a5c3c7525fe166b5a0df2`. Final review found
that exact `sass-embedded@1.100.0` starts a refed Dart child before both invalid
compiler constructors throw. The pure-Sass facade throws the adapted exact
error but naturally exits. CJS/ESM × sync/async constructor × two isolated
attempts reproduce the difference in
`reference/sass-constructor-liveness-post-pickup-fork.md`.

This is `observable-order` plus `frozen-assumption`: the ready transcript pinned
the error value but erased post-catch process liveness. A timer, MessagePort, or
unrelated Worker would fake the missing Dart child; the frozen carrier forbids
shipping the native runtime asset. Manual `rifty-refine` must settle the
observable fork: change the carrier to preserve the real child lifecycle, or
make invalid direct construction an explicit named gap and narrow only that
positive claim. The pre-demotion Acceptance and Parity cases are retained
verbatim in the reference artifact.

## Readiness blockers

- Resolve the post-pickup invalid-construction lifecycle fork through manual
  `rifty-refine`; no implementation pickup while the observable choice is open.
- Commit the complete Node v24.16.0
  `sass@1.100.0`/`sass-embedded@1.100.0` differential command, exact output,
  package identities, and timeout/deadlock procedure behind all nine parity
  rows. ADR-0310's summary and the selector-only probe are not the artifact.
- Close every row in the Fault matrix below with a reachable proof target. The
  official Sass manifest is the positive carrier for non-bundled required
  traversal and omitted-optional suppression; injected or synthetic recipes
  cannot close either branch.

## Acceptance

- Fresh/replay/snapshot and applicable general-Eddy materialization retain the
  exact substitution marker and acquisition provenance.
- Before tarball work, the official `sass@1.100.0` manifest exactly matches the
  recipe's complete required, optional, peer, bundled, and omitted-optional
  projection. Drift in any map rejects with
  `NotImplementedError('sass-embedded.acquisition')` before cache, VFS, tree,
  lock, facade, or success effects.
- The exact non-bundled required dependencies enter the ordinary resolver and
  materialize their complete registry closure with exact range, version,
  integrity, tree, and lock facts. The omitted `@parcel/watcher` optional
  dependency causes zero registry/cache reads and no tree or materialized-child
  lock entry.
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
- Seam gate: a repository check rejects Sass-name recognition in generic
  catalog consumers, registry resolution, installer/planner/provenance, VFS,
  Workbench, kernel/runtime, manager/store, MessagePort, or the esbuild adapter.
  Generic edits are limited to data-driven catalog redirect derivation,
  dependency-projection execution, and exact lock/replay validation. No second
  resolver, cache, lock, scheduler, facade publisher, or package-tree owner.

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
| corrupt-input | drifted recipe, every complete dependency map, facade bytes, bin target, or provenance rejects before publish/reuse | catalog/installer/lock mutation table |
| observable-order | unsupported version/CLI rejects before rejected-package acquisition or writes; importer/logger lifecycle matches the pinned Node order | ordered install + differential ledgers |
| provenance-lie | fresh/replay/snapshot preserve exact Sass/twin identities and never substitute native or host bytes | fresh→replay→snapshot differential |
| unbounded-read / corrupt-input / provenance-lie | stalled, partial, corrupt, or failed Sass or required-closure registry/tarball acquisition publishes no facade, bin, success report, or lock; retry materializes exact bytes | parent/required-child acquisition boundary faults + retry |
| torn-state | abort during facade/bin writes publishes no lock/success; retry reconciles the exact tree | materialization abort fault |
| quota-perm-fail | facade/bin write rejection remains loud and publishes no lock/success | VFS fault matrix |
| sibling-drift | direct CJS/ESM and Vite dev/HMR/build share one recipe/facade and adapted-divergence table | full acceptance cross-product |

## Out of scope

- `sass-embedded` versions other than 1.100.0 and any version range —
  `NotImplementedError('sass-embedded.version')` + compat ❌.
- The `sass` CLI/bin — `NotImplementedError('sass-embedded.cli')` + compat ❌.
- Watch mode / `@parcel/watcher` surface.
- Retained-optional execution, non-empty peer handoff/placement, and a positive
  scoped key in every projection map. No current builtin recipe honestly
  carries those branches; they remain explicit in
  `npm-client/shadow-recipe-v2-dependency-projection-execution` and
  `npm-client/npm-11-peer-placement-authority`, outside this frozen goal.
- A Sass runtime-asset adapter or any no-op Workbench adapter to fake N=2 on
  the runtime-asset seam (forbidden by ADR-0310).

## Decisions

- `post-pickup-demotion: 2026-08-02` — exact constructor liveness disproved the
  ready positive claim; attempt/checkpoint lineage and the complete frozen
  Acceptance/Parity text are retained in
  `reference/sass-constructor-liveness-post-pickup-fork.md`.
- ADR-0310 owns the carrier and the adapted-divergence list.
- ADR-0335 owns the recipe/materialization model this slice instantiates.
- The pinned Sass 1.100.0 selector probe proves `process.versions.node` is the
  Node-path selector; `process.release` is not a prerequisite.
- `goal-recut: 2026-08-02` — the official Sass manifest is the real builtin
  carrier for non-bundled required traversal and omitted optional suppression.
  Retained optionals, non-empty peers, and positive scoped keys have no honest
  production carrier in the frozen catalog and remain ordinary backlog rather
  than blocking the Sass outcome.
- Delete-on-done with the sass-scale-proof PR; epic closure requires this
  slice (not optional downstream).
