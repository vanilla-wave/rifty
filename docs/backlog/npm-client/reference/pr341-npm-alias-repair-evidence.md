# PR 341 — npm alias repair evidence

2026-10-13, Node v24.16.0/npm 11.17.0. Authority: observed setup failure;
ADR-0526. No Rifty cloud registry. Original npm manifests/tarballs vendored;
real npm and real rifty installer/VFS/loader use a localhost HTTP registry.

## Root cause and class

`resolveEffectivePackageRequest` returned one name for both acquisition and
placement. Declared `npm:` aliases reached registry under dependency key and
raw spec; root admission instead threw `npm-client.dependency-spec.npm-alias`.
An npm alias needs alias install path and target registry/cache identity.

Sibling sweep: root/transitive/optional request shaping; live selection,
retained lookup/reuse; placement/direct reservations; lock writer; npm alias
overrides; Eddy request ownership, bundle completeness and resolver harvest.
One shaping authority fixes acquisition/placement. Eddy bundle/cache keys use
lock `name` (target), paths keep alias. Bin owner remains install name;
string bin normalization uses original manifest name. Workbench dependency
snapshot cache requirements use attested shadow acquisition names, never a
bare ordinary alias path; ordinary registry cache portability remains its
explicit existing exclusion (`dep-snapshot.test.ts`).

## RED → GREEN

Initial `pnpm exec vitest run packages/npm-client/src/installer-npm-alias.parity.test.ts`:
3 failing tests after native npm successes. Root: named npm-alias throw;
transitive/override cliui: `Failed to fetch packument wrap-ansi-cjs: 404`.
Suite moved to `tests/integration` because acceptance exercises cross-package
runtime/Eddy code; no source-package TypeScript root expansion.

Final `pnpm exec vitest run tests/integration/npm-alias.parity.test.ts packages/npm-client/src/overrides-npm-value.contract.test.ts services/eddy/tests/resolver.test.ts`:
3 files, 85 tests PASS; alias suite initially6 PASS; final range-less carrier7 PASS. Native oracle rebuilt for every
scenario; compares every dependent's visible version/resolved/integrity/name,
original manifest bytes, exact native-lock paths, offline replay, CJS
string-width/strip-ansi output, alias module-instance identity. Covers root,
scoped, case-insensitive prefix, omitted range, aliases beside real target,
cliui CJS aliases, npm alias overrides, invalid target, retained target drift,
canonical Eddy tarball harvest/dedup/completeness.

Fresh exact-path comparison initially exposed existing higher-hoisting
variation. ADR-0042/0303 explicitly exclude highest-possible fresh hoisting;
acceptance therefore compares resolution at every edge, retaining exact-path
assertions for native-lock replay. Original alias defect assertions unchanged.

## Revert checks

Main source stayed frozen; independent `/tmp/pr341/alias-revert` copy ran the
same durable suite through Vitest. Restoring baseline `shadow-shims.ts`:
3 parity cases RED (`root-alias` / `wrap-ansi-cjs` registry 404).
Restoring baseline Eddy `resolver.ts` alone: canonical-harvest test RED,
`unsupported` instead of bundle. Reverting completeness target name to
`lockfilePathBareName(path)` alone: canonical-harvest test RED, missing
alias tarball despite exact target tarballs. Same-version wrong-target guard
reversion separately rejects the retained-target-drift test.

## Fault matrix

Boundary: owned in-process policy/graph projection, fault-classes row. Birth
trace above fixes the model here; network/storage behavior stays with its
existing owners and suites.

| Axis | Outcome / proof |
|---|---|
| corrupt-input | Non-registry alias target throws before HTTP; dedicated fault row. |
| poisoned-cache | Wrong retained target cannot reuse a same-version pin; cache/Eddy identity canonical. |
| provenance-lie | Eddy completeness accepts only actual target tarballs; alias names never masquerade as acquisition identity. |
| observable-order | Invalid root alias admission precedes metadata/tarball calls. |
| sibling-drift | One request authority; live/native-lock/offline/Eddy cases exercised. |
| frozen-assumption | Real npm 11.17.0 over original npm archives, version captured in session. |
| lossy-aggregate | Two aliases to same target remain separate modules; real target version can coexist; canonical Eddy tarball dedup checked. |
| unbounded-read | Struck here: finite string classification; no streams or retry/progress loop. |
| torn-state | Struck here: shaping constructs a value without publishing mutable state; writes remain existing installer/cache owners. |
| concurrent-same-key | Struck here: synchronous pure classification; no shared writer introduced. |
| quota-perm-fail | Struck here: no persistence operation in shaping. Existing I/O owners preserve loud errors. |
| false-fallback | Retained identity mismatch selects real metadata; never wrong pin or happy-path substitute. |

Transport loss, duplicate delivery and reorder struck by this boundary's
physical exclusion. No new correlation/FIFO/epoch/ledger/lock mechanism.

## Residuals

Fresh highest-possible hoisting remains ADR-0042/0303's existing limitation.
`wrap-ansi@7` runtime hits existing getter-only `module.exports` in original
ansi-styles4.3.0; ordinary ansi-styles import without installer/alias reproduces
it. Draft/probe: `runtime-js/cjs-getter-only-module-exports`; setup install
contract does not require wrap-ansi execution. Non-registry/lifecycle/native
ceilings remain explicit. Parent owns independent final review/full PR gate.

## Independent coverage follow-up

Reviewer C1: preserving the original range for a range-less npm alias override
passed78 existing tests. Added real npm scenario: cliui strip-ansi-cjs edge
requests ^6, override npm:string-width (fixture has4/5, no6). Native npm and
current Rifty select target default;7 integration tests GREEN. Same reviewer
mutant RED: `No matching version for string-width@^6.0.1`. Product code unchanged.
