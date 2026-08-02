# Shadow recipe v2 Contract+RED

## Acquisition-validation re-cut — 2026-08-02

Fresh source baseline is
`main@4a2beb233cc2127ef531b0eba2584797234865f1`, including the materialized-bin
commit authority merged by PR #237. The mapped Item 19 retains Budget
`300–800`, but is narrowed in place to exact registry projection and embedded
manifest validation at the shared fresh/current-replay/Eddy package ingress.
Bundled-source traversal/lock topology is deferred to blocked draft child
`npm-client/shadow-recipe-v2-embedded-source-authority` (Budget `200–500`);
protocol-v2 replay and its Workbench/Chromium consumers follow in blocked draft
`npm-client/shadow-recipe-v2-protocol-replay-authority` (Budget `300–800`).

Combined checkpoint `812cd8b0e5c653674bae949d67f0ac21db90748f`
contains no production source, but Standards blocked it; it is lineage only and
cannot support a `ready-verdict`. The three blockers were:

1. **frozen-assumption / provenance-lie:** a generated miniature archive plus
   JSON/literal cross-check never fed the real pinned npm tarball through the
   installer or proved all four real embedded members. The replacement carrier
   must feed integrity-verified real tarball bytes through root and nested fresh
   installs; generated archives are mutation inputs only. Replay/Eddy repeat
   that evidence only where their downstream ingress requires it.
2. **unratified observable:** ten replay RED rows were manufactured solely by
   requiring `hasCause: false`, although neither item nor ADR fixed nested error
   shape. The downstream child keeps the mutations as public
   `EBROKENLOCK`/`shadow-trace-drift` regressions and imposes no `cause`
   presence/absence contract.
3. **budget / split:** the combined checkpoint added 1,657 TypeScript test lines,
   above twice the `300–800` source band. `docs/backlog/README.md` §Budget
   requires separate dependency-ordered acquisition/embedded-source and
   protocol-v2 replay items, Budgets, and checkpoints.

Replacement checkpoint `f5dbb4e021380dbdbbd964e33b434e47c2348618`
closed those blockers, but Spec found no negative proof for embedded manifest
identity/version validation. As the second consecutive Contract+RED blocker,
`docs/process/fault-classes.md` §Review convergence requires another split.
Technical PASS `0455ceb9683d6bed9a0ddc9f4fd1a5738ab537d7` cannot authorize pickup:
it is lineage for the validation → embedded-source topology → protocol-v2
sequence. No topology, protocol-v2, Workbench FIFO, or Chromium assertion from
those combined checkpoints is evidence for narrowed Item 19.

The inherited GREEN floors that remain required are:

```sh
pnpm vitest run --project unit \
  packages/npm-client/src/registry.fault.test.ts \
  packages/npm-client/src/internal/shadow/planner.contract.test.ts \
  packages/npm-client/src/internal/shadow/installer.contract.test.ts
pnpm --filter @riftydev/npm-client typecheck
pnpm --filter @riftydev/shadow-registry typecheck
pnpm backlog:check
pnpm check:arch
pnpm check:runtime-adapter-boundary
git diff --check
```

The narrowed current carrier runs this exact batch against the fresh baseline:

```sh
pnpm --filter @riftydev/npm-client exec vitest run \
  src/installer-shadow-recipe-v2-acquisition-replay-authority.contract.test.ts \
  src/internal/shadow/installer.contract.test.ts \
  src/internal/shadow/planner.contract.test.ts \
  src/registry.fault.test.ts
pnpm --filter @riftydev/shadow-registry exec vitest run \
  src/internal/catalog-v2-data-authority.contract.test.ts
```

The npm-client run has 11 RED and 53 GREEN tests:

- the acquisition-validation carrier is 11 RED / 2 GREEN: eight complete-
  projection mutations reach effects; three embedded missing/name/version
  mutations reach link instead of rejecting; root/nested official-tar fresh,
  matching current-protocol replay, and generic Eddy validation are GREEN;
- installer provenance, planner, and bounded registry floors are respectively
  17/17, 26/26, and 8/8 GREEN.

The shadow-registry authority is 110/110 GREEN. It reads the committed official
3,821,302-byte npm archive, verifies SHA-256
`ea1419e577dd943907c7e17a99fa7a76143d99c6279a6131e79fb4b1b098ac89`,
matches its SRI to the registry golden, and independently inventories and
hashes all four embedded `napi-wasm@1.1.3` members. No production source differs
from the fresh baseline at this checkpoint. Standalone bundled-source topology
is deliberately neither asserted nor blessed by this validation checkpoint.

The predecessor checkpoints and counts below are retained as historical
lineage; neither they nor checkpoints `812cd8b0`, `f5dbb4e0`, or `0455ceb9`
serves as this narrowed successor's verdict.

## Retained predecessor lineage

Recorded 2026-07-28 against source-only contract commit
`db1871b987c990925d9632080b9b81723ea0e298`. No production source differs from
that commit. Checkpoint `8f3251e8` was blocked because replay and sibling
expectations were masked. Re-cut `d5ffb3d2` was blocked because projection
faults were still unreachable and peer evidence was lossy. The binding
two-blocker rule split npm peer execution into
`npm-client/npm-11-peer-placement-authority`; the transcript below is the
narrowed projection/materialization unit. Its first checkpoint `5c450fb9`
blocked a prescribed acquisition-module carrier, one stale installer sibling,
an incomplete generic-source gate, and repo lint. Its second checkpoint
`b7725a3e` closed that re-cut but blocked the contract's remaining broad
projection claims: the only positive registry oracle has required bundled
`napi-wasm` plus empty optional/peer maps. Mutation-only RED cannot prove
matching non-bundled traversal, optional omission, non-empty peer handoff, or
accepted scoped keys. The binding split preserves those clauses in the required
draft child `npm-client/shadow-recipe-v2-dependency-projection-execution`.
The transcript below is the now-executable LightningCSS
metadata/bundle/materialized-bin/replay unit; counts remain unchanged.
Fresh first checkpoint `092d931a` blocked two omitted proof rows and one stale
post-split claim: the transcript did not record the existing direct CJS/ESM
browser differential or inherited registry unbounded-read suite, and one test
title still claimed broad retained projection. This re-cut records both GREEN
suites and narrows the stale wording without changing assertions or production.

```sh
pnpm --filter @riftydev/npm-client exec vitest run \
  src/internal/shadow/recipe-v2-authority.contract.test.ts \
  src/shadow-recipe-v2-data-authority.contract.test.ts \
  src/installer-shadow-shims.test.ts \
  src/internal/shadow/installer.contract.test.ts
pnpm --filter @riftydev/npm-client exec vitest run \
  src/installer-bin-authority.contract.test.ts
pnpm --filter @riftydev/npm-client exec vitest run \
  src/registry.fault.test.ts
pnpm --filter @riftydev/workbench exec vitest run \
  src/workers/owner-package-shadow-assets.contract.test.ts
pnpm test:browser-unit tests/browser-unit/esbuild-vite-contract.spec.ts \
  --grep "Vite 7 config graph"
pnpm test:browser-unit tests/browser-unit/esbuild-vite-contract.spec.ts \
  --grep "direct CJS require and ESM import"
pnpm check:runtime-adapter-boundary
```

The npm-client runs have 26 RED and 61 GREEN tests:

- seven exact LightningCSS projection drifts reach registry traversal instead
  of the named pre-tarball `NotImplementedError`; these are rejection evidence,
  not a positive claim that non-bundled/optional/peer/scoped branches execute;
- the exact installer provenance sibling attempts an external `napi-wasm`
  packument read instead of consuming only the embedded bundled member; its
  seventeen other provenance assertions remain reachable and GREEN;
- exact LightningCSS fixtures request bundled `napi-wasm` externally; the
  previous data-authority and legacy sibling expectations now fail with them;
- a pre-seeded v2 LightningCSS+esbuild replay enters lock ingress and rejects
  protocol v2 before any registry read;
- acquired bin disk and lock leaks are both observed; materialized bins are
  absent or keep non-canonical lock spelling;
- shared commands remain manifest-order dependent, incremental launchers remain
  stale, and nested scopes choose the wrong owner;
- root and nested parked alias aborts continue later writes; root/nested alias
  `ENOSPC`/`EACCES` plus ordinary bin fault guards already fail loudly, publish
  no lock, and reconcile on retry.

The generic-source gate is GREEN across the finite admission, installer,
linker, planner, manager, and Workbench consumer surface. It rejects concrete esbuild,
LightningCSS/acquisition-member, Sass, and Vite names or control-flow
identifiers, so the real-core RED cannot be closed by a package-specific
branch. It prescribes no new module or helper export.

The Workbench run has one GREEN and one RED test. Its soft assertions
independently observe protocol v1, missing `materialization.bin`, and
`./bin/esbuild` lock spelling. Physical exclusion is GREEN: while the first real
installer is parked at `/package-lock.json`, the second cannot enter the core
or write.

The inherited `RegistryClient` fault run is 8/8 GREEN: header, packument-body,
tarball-body, and runaway-body bounds stay loud; slow progress succeeds; retry
and final non-OK paths cancel discarded response bodies.

The real Chromium Vite 7.3.6 case completes dev/build/preview/optimize and then
independently reports the same three lock gaps from the project’s actual
`package-lock.json`. The separate direct CJS/ESM Chromium differential is 1/1
GREEN against real Node esbuild 0.28.0 and observes the loud unsupported CLI
without Vite.

## Acquisition-validation implementation and closure

Ready/pickup parent `5d6f3ff17b4ac7ff92b9d71869bf12d261cb2140`
precedes production `734d830ce421dca93ea64af1b2bd002af4d76015`.
The existing registry source now exact-compares required, complete optional,
peer, and either npm bundle-alias projection immediately after version
selection. The shared extracted-package ingress validates every recipe-declared
bundled manifest name and admitted version before package assembly, VFS,
reports, or lock mutation. Fresh, current replay, and Eddy therefore share one
private validation seam. No public API, protocol, topology, source, cache,
lock, or coordination mechanism was added.

The frozen carrier remains Git blob
`a44d57f4ed17a9da978ec199d56150988762b26b`, SHA-256
`0d4817585dd69f040f3faab62aa0230af984e2d88ad9fe942fbd418c503c2df2`,
and runs 13/13 GREEN. The stabilized acquisition/data/materialized-bin/shims/
installer/planner/catalog batch runs 240/240 GREEN; npm-client typecheck,
Biome, diff, contract-drift, goal-contract, budget, and backlog gates pass.

Pre-pickup process correction
`88f1470c1a45b45510fe089e1561f23a30d1a0f0` keeps only this selected slice's
Items/Budget mapping. The two latest mandatory split children and the earlier
dependency-projection child remain reverse-linked draft goal residuals; each
mapping and Budget row waits for its own pre-pickup branch. Closure deletes the
completed validation item and subtracts only its exact blockers.
Embedded-source topology, broad projection execution, and protocol-v2 replay
remain unimplemented and loud where already specified.
