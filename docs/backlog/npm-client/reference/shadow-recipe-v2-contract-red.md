# Shadow recipe v2 Contract+RED

## Acquisition/embedded-source re-cut — 2026-08-02

Fresh source baseline is
`main@4a2beb233cc2127ef531b0eba2584797234865f1`, including the materialized-bin
commit authority merged by PR #237. The mapped Item 19 retains Budget
`300–800`, but is narrowed in place to the first dependency-ordered unit: exact
registry projection, integrity-verified real tarball acquisition, embedded
`napi-wasm@1.1.3`, and truthful root/nested fresh lock facts. Protocol-v2
trace/replay and its Workbench/Chromium consumers are deferred to blocked draft
child `npm-client/shadow-recipe-v2-protocol-replay-authority` with its own
Budget `300–800` and future checkpoint.

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

The replacement acquisition checkpoint must bind one real-tarball carrier to
the existing data, materialized-bin, installer provenance, planner, and
registry-fault siblings. Its exact command, blob, and RED/GREEN counts are
recorded only after that narrowed carrier exists and passes fresh Standards+
Spec review. No replay, Workbench FIFO, or Chromium-v2 assertion/count from
`812cd8b0` is evidence for Item 19.

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

Replacement checkpoint `f5dbb4e021380dbdbbd964e33b434e47c2348618`
closed the three blockers above; Standards passed, but Spec blocked one missing
negative proof: the official archive proved the embedded files positively,
while no RED forced the installer to reject a missing or wrong embedded
manifest before link effects. The re-cut adds missing, name-drift, and
version/range-drift generated-tar mutations while retaining the official
archive as the only positive oracle.

The narrowed current carrier runs this exact batch against the fresh baseline:

```sh
pnpm --filter @riftydev/npm-client exec vitest run \
  src/installer-shadow-recipe-v2-acquisition-replay-authority.contract.test.ts \
  src/shadow-recipe-v2-data-authority.contract.test.ts \
  src/installer-shadow-materialized-bin-commit-authority.contract.test.ts \
  src/installer-shadow-shims.test.ts \
  src/internal/shadow/installer.contract.test.ts \
  src/internal/shadow/planner.contract.test.ts \
  src/registry.fault.test.ts
pnpm --filter @riftydev/shadow-registry exec vitest run \
  src/internal/catalog-v2-data-authority.contract.test.ts
```

The npm-client run has 21 RED and 117 GREEN tests:

- the acquisition carrier is 13/13 RED: eight complete-projection mutations
  reach effects; three embedded missing/name/version mutations do not reject
  before link effects; and root/nested fresh, matching current-protocol replay,
  and generic Eddy ingress still acquire a standalone child and omit the exact
  parent bundle plus embedded-child lock facts;
- the inherited data-authority matrix is 6 RED / 19 GREEN, with only the six
  direct/transitive fresh/replay/Eddy LightningCSS ledgers exposing standalone
  child registry/cache work;
- the materialized commit sibling is 1 RED / 22 GREEN and the shim sibling is
  1 RED / 25 GREEN because each still publishes the standalone child topology;
- installer provenance, planner, and bounded registry floors are respectively
  17/17, 26/26, and 8/8 GREEN.

The shadow-registry authority is 110/110 GREEN. It reads the committed official
3,821,302-byte npm archive, verifies SHA-256
`ea1419e577dd943907c7e17a99fa7a76143d99c6279a6131e79fb4b1b098ac89`,
matches its SRI to the registry golden, and independently inventories and
hashes all four embedded `napi-wasm@1.1.3` members. No production source differs
from the fresh baseline at this checkpoint.

The predecessor checkpoints and counts below are retained as historical
lineage; neither they nor blocked checkpoint `812cd8b0` serves as this narrowed
successor's verdict.

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
