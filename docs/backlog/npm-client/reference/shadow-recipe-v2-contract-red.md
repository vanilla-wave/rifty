# Shadow recipe v2 Contract+RED

## Acquisition/replay checkpoint evidence — 2026-08-02

Fresh source baseline is
`main@4a2beb233cc2127ef531b0eba2584797234865f1`, including the materialized-bin
commit authority merged by PR #237. The mapped acquisition/replay item remains
draft until fresh Standards+Spec review passes this exact tests/docs tree; its
later `ready-verdict` owns the reviewed commit SHA.

The committed machine-checked tarball-member golden at
`tools/shadow-registry/src/fixtures/lightningcss-wasm-1.32.0-tarball.json`
binds the real `lightningcss-wasm@1.32.0` tarball to its embedded
`napi-wasm@1.1.3` manifest and member bytes independently of catalog source or
installer-built fixtures. The isolated successor carrier is
`packages/npm-client/src/installer-shadow-recipe-v2-acquisition-replay-authority.contract.test.ts`
(blob `4530972ac2fde73b0b681461a33745a2d6c72213`) plus the literal-lock replay
carrier
`packages/npm-client/src/installer-shadow-recipe-v2-replay-authority.contract.test.ts`
(blob `99636f9d8dfb93c81a7b2a3fae0e607dcbc7cb89`). They own only complete source
projection, embedded acquisition, protocol-v2 trace/replay, and their
pre-effect drift gates. The replay carrier copies literal reviewed facts and
does not obtain its oracle from the production attester. Neither carrier
recopies the completed materialized-bin commit boundary.

The exact npm-client checkpoint command is:

```sh
pnpm vitest run --project unit \
  packages/npm-client/src/installer-shadow-recipe-v2-acquisition-replay-authority.contract.test.ts \
  packages/npm-client/src/installer-shadow-recipe-v2-replay-authority.contract.test.ts \
  packages/npm-client/src/shadow-recipe-v2-data-authority.contract.test.ts \
  packages/npm-client/src/installer-shadow-materialized-bin-commit-authority.contract.test.ts \
  packages/npm-client/src/installer-shadow-shims.test.ts \
  packages/npm-client/src/internal/shadow/installer.contract.test.ts \
  packages/npm-client/src/internal/shadow/planner.contract.test.ts \
  packages/npm-client/src/registry.fault.test.ts
```

It has exactly 30 RED and 117 GREEN, with no pending tests:

- acquisition carrier: 10/10 RED — eight independent complete-projection
  drifts still cross tar/cache/VFS/report/lock boundaries; exact root and nested
  installs still fetch/cache/install `napi-wasm` as a standalone root package,
  omit the bundled lock child, and emit protocol v1 without complete trace/bin
  evidence;
- literal replay carrier: 12/12 RED — matching root/nested v2 locks reject the
  generic unsupported protocol before cache replay; ten independent lock/trace
  corruptions reach `EBROKENLOCK` but not the required field-specific
  pre-effect rejection path;
- inherited touched siblings: 8 RED / 83 GREEN — data authority 6/19,
  materialized-bin authority 1/22, installer shims 1/25, internal provenance
  0/17; their REDs all observe the same external bundled-child/protocol/bin
  gaps rather than fixture lookup failures;
- inherited planner and `RegistryClient` floors: 34/34 GREEN, including all
  eight progress-bounded/cancellation fault cases and schema-1 canonical-first
  rejection.

The Workbench real-core carrier is independently 1 RED / 1 GREEN. The second
same-project install remains physically outside the core while the first is
parked before lock publication; only protocol v1, missing trace bin, and
non-canonical lock bin spelling remain RED. The real-tarball catalog authority
is 110/110 GREEN and checks fixture blob
`7868fd3c91752fbbaff7a9cfda33d1afe24f6a3c` against the independently captured
tarball identity and all four embedded `napi-wasm@1.1.3` members.

```sh
pnpm vitest run --project unit \
  packages/workbench/src/workers/owner-package-shadow-assets.contract.test.ts
pnpm vitest run --project unit \
  tools/shadow-registry/src/internal/catalog-v2-data-authority.contract.test.ts
pnpm test:browser-unit tests/browser-unit/esbuild-vite-contract.spec.ts \
  --grep "Vite 7 config graph"
pnpm test:browser-unit tests/browser-unit/esbuild-vite-contract.spec.ts \
  --grep "direct CJS require and ESM import"
```

Real Chromium direct CJS/ESM esbuild parity is 1/1 GREEN. The Vite 7.3.6 case
completes dev/build/preview/optimize, then is exactly 1/1 RED on three soft lock
assertions: protocol v1 instead of v2, absent trace `materialization.bin`, and
`./bin/esbuild` instead of canonical `bin/esbuild` in the package entry.

All non-behavioral checkpoint gates are GREEN:

```sh
pnpm --filter @riftydev/npm-client typecheck
pnpm --filter @riftydev/workbench typecheck
pnpm --filter @riftydev/shadow-registry typecheck
pnpm backlog:check
pnpm check:arch
pnpm check:runtime-adapter-boundary
git diff --check
```

The checkpoint contains no production-source edit. The following inherited
GREEN floors must remain green through implementation:

```sh
pnpm vitest run --project unit \
  packages/npm-client/src/registry.fault.test.ts \
  packages/npm-client/src/internal/shadow/planner.contract.test.ts \
  packages/npm-client/src/internal/shadow/installer.contract.test.ts
```

The predecessor checkpoints and counts below are retained as historical
lineage; none serves as this successor's verdict.

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
