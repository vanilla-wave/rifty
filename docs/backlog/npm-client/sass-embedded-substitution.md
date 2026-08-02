---
area: npm-client
status: draft
title: sass-embedded@1.100.0 via synthesized facade — second substitution, seam proof
created: 2026-07-23
why: real Vite SCSS projects pin sass-embedded, whose Dart platform binary cannot run in the browser; ADR-0344's evidence proves the exact pure-JS Sass twin matches every named supported surface Vite and direct consumers touch, while invalid direct construction remains an explicit gap
epic: honest-shadow-substitutions
sources: [ADR-0344, ADR-0335, docs/backlog/npm-client/reference/sass-1.100-node-selector-probe.md, docs/backlog/npm-client/reference/sass-1.100.0-packument.md, docs/backlog/npm-client/reference/sass-1.100.0-node-differential.md, docs/backlog/npm-client/reference/sass-constructor-liveness-post-pickup-fork.md]
---

## Context

Slice `sass-scale-proof` (see epic §Budget). Carrier decided by ADR-0344
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
shipping the native runtime asset. On 2026-08-03 the user selected the honest
no-runtime outcome: invalid direct construction is a named unsupported gap,
while instances returned by `initCompiler()` / `initAsyncCompiler()` retain the
full positive lifecycle claim. The pre-demotion Acceptance and Parity cases are
retained verbatim in the reference artifact.

## Reference contract

- Node v24.16.0 runs one committed nine-row probe against exact public
  `sass@1.100.0` and `sass-embedded@1.100.0`; package identities, complete
  normalized transcripts, reproduction command, and the isolated two-attempt
  deadlock procedure are pinned in
  `reference/sass-1.100.0-node-differential.md`.
- The public `sass@1.100.0` packument, tarball bytes, required closure, and
  omitted `@parcel/watcher` projection are pinned in
  `reference/sass-1.100.0-packument.md` and executable shadow-registry tests.
- Real Chromium with exact Vite 7.3.6 is the integration oracle for direct
  CJS/ESM loading, SCSS dev/HMR/build, offline replay, and the measured cold
  install row. The twice-reproduced real-Node build bytes and offline npm
  replay are pinned in `reference/sass-vite-7.3.6-node-build.md`.

## Readiness evidence

- The complete Node v24.16.0 differential, exact package/entry identities,
  normalized nine-row output, and isolated twice-run deadlock procedure are
  committed and independently executable.
- The twice-reproduced Node/npm Vite build and offline replay pin exact output
  bytes, warning count, lock facts, and the observed absence of an external
  CSS map.
- Every Fault-matrix row has a reachable Contract+RED target. Official npm
  tarballs carry positive Sass traversal; generated archives carry only
  corrupt/injection inputs. Exact commands, counts, ledgers, inherited bounds,
  and the zero-production-source checkpoint are recorded in
  `reference/sass-embedded-contract-red.md`.

## Acceptance

- Fresh install, lockfile replay, durable reopen, and applicable general-Eddy
  materialization retain the exact substitution marker and acquisition
  provenance.
- Required-OPFS Chromium injects real Sass-tarball network loss, publishes no
  facade or lock, survives abrupt owner teardown, then retries exactly; a
  second abrupt offline reopen reuses the byte-identical tree and provenance.
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
  ADR-0344 differential suite, including initialized compiler lifecycle
  (repeated path and string compilations; sync/async dispose return values;
  path/string post-dispose error texts), sync+async importers, logger
  warn/deprecation with absolute color-neutral frames, sourceMap bytes, error
  `sassMessage`/span/message shape with absolute color-neutral frames, and
  synthesized `info`.
- CJS and ESM direct `new Compiler()` / `new AsyncCompiler()` synchronously
  throw
  `NotImplementedError('sass-embedded.compiler-construction-liveness')` before
  the pure-Sass constructor or any active resource. The exact embedded child
  liveness stays pinned by the post-pickup oracle and the surface is compat ❌.
- Real Vite 7.3.6 SCSS project: nested partial and Vite-resolved `@use`,
  custom importer and a warning; dev renders exact normalized CSS, an edit
  HMRs, and build emits the exact Node-oracle CSS/dependency facts. Node emits
  no external CSS map for this configuration, so rifty must not invent one.
- The named divergence (sync compile + async importer: loud throw where real
  sass-embedded deadlocks) is a compat ⚠ note with a differential test
  pinning BOTH behaviors.
- Direct compiler construction, unsupported versions, CLI/bin, watch mode, and
  missing TypeScript declarations are explicit compat ❌. Reachable runtime
  gaps throw their exact named `NotImplementedError('sass-embedded.<gap>')`;
  the facade claims only the finite differential rows rather than inventing a
  catch-all API gap.
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
ADR-0344 evidence; each is a differential test:

1. CJS/ESM export shape (cleaned namespace; no dart2js dead keys).
2. `compileString`/`compileStringAsync` css + `loadedUrls` + absent sourceMap.
3. `sourceMap: true` + `sourceMapIncludeSources: true` byte-identical map.
4. Initialized compiler lifecycle: repeated `compile` / `compileString` and
   `compileAsync` / `compileStringAsync`; dispose return values; exact
   post-dispose path/string errors (`Compiler caused error: Sync|Async compiler
   has already been disposed.`); initialized instances retain `instanceof`
   against the exported constructor anchors.
5. Modern importer sync + async incl. `containingUrl`; `loadedUrls` content.
6. Logger: `@warn` call shape; `slash-div` deprecation id + span.
7. Errors: `expected "}".` and missing-@use — `Error: `-prefixed message,
   sassMessage, span start/end/text, `span.url: undefined`.
8. `info === "sass-embedded\t1.100.0"`.
9. Legacy `renderSync` output + stats keys + legacy-js-api deprecation.
10. CJS/ESM direct construction: exact embedded starts a refed Dart child before
    its construction error and remains alive; rifty synchronously throws
    `NotImplementedError('sass-embedded.compiler-construction-liveness')`
    before target construction or resource creation.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input | drifted recipe, every complete dependency map, facade bytes, bin target, or provenance rejects before publish/reuse | catalog/installer/lock mutation table |
| observable-order | direct construction rejects before target construction or any active resource; unsupported version rejects before rejected-package acquisition or writes; CLI/watch execution stays loud after the pure-JS facade install without native acquisition; importer/logger lifecycle matches the pinned Node order | constructor-liveness oracle, ordered install, CLI/watch, and differential ledgers |
| provenance-lie | fresh/replay/durable reopen/general Eddy preserve exact Sass/twin identities and never substitute native or host bytes | fresh→replay→durable reopen plus general-Eddy differential |
| unbounded-read / corrupt-input / provenance-lie | stalled, partial, corrupt, or failed Sass or required-closure registry/tarball acquisition publishes no facade, bin, success report, or lock; retry materializes exact bytes | parent/required-child acquisition boundary faults + retry; real Chromium Sass-tarball network loss + abrupt required-OPFS reopen |
| torn-state | abort during facade/bin writes publishes no lock/success; retry reconciles the exact tree | materialization abort fault |
| quota-perm-fail | facade/bin write rejection remains loud and publishes no lock/success | VFS fault matrix |
| concurrent-same-key | two Sass installs for one project enter the real installer one at a time and commit one exact tree/lock/provenance state | owner FIFO with the first lock write parked |
| sibling-drift | direct CJS/ESM and Vite dev/HMR/build share one recipe/facade and adapted-divergence table | full acceptance cross-product |

## Out of scope

- Direct `new Compiler()` / `new AsyncCompiler()` process-lifecycle parity —
  `NotImplementedError('sass-embedded.compiler-construction-liveness')` +
  compat ❌; exported anchors remain for initialized-instance `instanceof`.
- `sass-embedded` versions other than 1.100.0 and any version range —
  `NotImplementedError('sass-embedded.version')` + compat ❌.
- The `sass` CLI/bin — `NotImplementedError('sass-embedded.cli')` + compat ❌.
- Watch mode / `@parcel/watcher` surface.
- TypeScript declarations — compat ❌ with no dangling or approximate `types`
  target; TypeScript's missing-declaration diagnostic remains honest.
- Retained-optional execution, non-empty peer handoff/placement, and a positive
  scoped key in every projection map. No current builtin recipe honestly
  carries those branches; they remain explicit in
  `npm-client/shadow-recipe-v2-dependency-projection-execution` and
  `npm-client/npm-11-peer-placement-authority`, outside this frozen goal.
- A Sass runtime-asset adapter or any no-op Workbench adapter to fake N=2 on
  the runtime-asset seam (forbidden by ADR-0344).

## Decisions

- `post-pickup-demotion: 2026-08-02` — exact constructor liveness disproved the
  ready positive claim; attempt/checkpoint lineage and the complete frozen
  Acceptance/Parity text are retained in
  `reference/sass-constructor-liveness-post-pickup-fork.md`.
- `manual-refine: 2026-08-03 — user` — direct constructor liveness becomes the
  named unsupported gap; initialized compiler lifecycle and every other
  positive compile/Vite claim remain unchanged; no runtime carrier is added.
- ADR-0344 owns the carrier, finite positive claims, and adapted-divergence list.
- ADR-0335 owns the recipe/materialization model this slice instantiates.
- The corrected Sass 1.100.0 selector probe proves two required gates:
  `process.versions.node` selects the Node bootstrap and
  `process.release.name === 'node'` selects the Node path API (ADR-0345).
- `goal-recut: 2026-08-02` — the official Sass manifest is the real builtin
  carrier for non-bundled required traversal and omitted optional suppression.
  Retained optionals, non-empty peers, and positive scoped keys have no honest
  production carrier in the frozen catalog and remain ordinary backlog rather
  than blocking the Sass outcome.
- `goal-recut: 2026-08-02` — baked dependency snapshot materialization is not a
  frozen Sass outcome or user path; the slice proves the epic's actual fresh,
  durable offline reopen, lock replay, and general-Eddy sources without adding
  a Sass-specific snapshot carrier.
- `goal-recut: 2026-08-02` — remove the impossible generic "unproven API"
  catch-all. The exact namespace and finite Node differential are the positive
  claim; only observed unsupported selectors, CLI/watch, and declaration
  surfaces receive named gaps.
- `goal-recut: 2026-08-02` — decision-subagent superseded ADR-0310 with
  ADR-0344: proof coverage is not a runtime discriminator; unknown observed
  mismatches are RED-first parity defects or specific reachable gaps.
- Delete-on-done with the sass-scale-proof PR; epic closure requires this
  slice (not optional downstream).
