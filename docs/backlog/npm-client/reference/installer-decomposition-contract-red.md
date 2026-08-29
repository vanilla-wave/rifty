# installer-decomposition Contract+RED

## Baseline — 2026-08-29 (re-cut after attempt-1 blockers)

Fresh source baseline is `main@686b650a402ef03ecd378a1df347623d5933ad91`.
Unit: `docs/backlog/npm-client/installer-decomposition.md` (standalone — no
goal directory). Move-only: every Parity row pins preservation against this
baseline; no production source differs from it at this checkpoint. Attempt-1
checkpoint tree `0af1f503d` was blocked (find + tail + adjudication: 5 HOLDS,
3 STRETCH → concerns, 1 FALSE); the item's §Demotion record carries the
blockers and pre-demotion contract verbatim. This document is the attempt-2
evidence for the re-cut.

Gate-facts at this baseline: `installer.ts` = 3064 gate-lines (pin 3066);
`linker.ts` = 604 gate-lines (not grandfathered — headroom 196 <
the 191-line bin-claim group + imports, forcing the dedicated
`installer-bin-claims.ts` carrier); `npm-client/src` direct prod modules:
21 by `ls packages/npm-client/src/*.ts | grep -v test | grep -v fixture | wc -l`
(threshold 30; up to 7 additions keep it ≤ 28).

## Parity 1 — install behavior identity (comparison artifact)

```sh
pnpm --filter @riftydev/npm-client exec vitest run \
  src/installer.test.ts \
  src/installer-pipeline.test.ts \
  src/installer-lockfile.test.ts \
  src/installer-concurrency.test.ts \
  src/installer-native-policy.test.ts \
  src/installer-peer-optional.test.ts \
  src/installer-shadow-shims.test.ts \
  src/installer-prepared-path-consumption.contract.test.ts \
  src/installer-sass-embedded-substitution.contract.test.ts \
  src/installer-shadow-materialized-bin-commit-authority.contract.test.ts \
  src/installer-shadow-recipe-v2-acquisition-replay-authority.contract.test.ts \
  src/installer-shadow-recipe-v2-embedded-source-authority.contract.test.ts \
  src/installer-shadow-recipe-v2-replay-authority.contract.test.ts \
  src/shadow-recipe-v2-data-authority.contract.test.ts \
  src/internal/shadow/installer.contract.test.ts \
  src/registry.fault.test.ts \
  src/internal/shadow/source.fault.test.ts \
  src/installer-package-bin-normalization.contract.test.ts
```

Result: **18 files, 404/404 GREEN** (vitest 4, Node v24.16.0). Composition:
the contract's original 13 named suites; plus the two remaining direct
`./installer.ts` importers `shadow-recipe-v2-data-authority.contract.test.ts`
and `internal/shadow/installer.contract.test.ts` (importer sweep: `rg` for
`from './installer.ts'` and `from '../../installer.ts'` across
`packages/npm-client/src`, test files); plus the two fault floors the contract
makes part of row 1 (`registry.fault.test.ts` 8/8,
`internal/shadow/source.fault.test.ts`); plus
`installer-package-bin-normalization.contract.test.ts` (3/3) covering the
moved bin/link path through the public `install`. GREEN target after the move:
same batch, same 404, with only import-path edits permitted in test files
(Acceptance 5, its two frozen exceptions included).

## Parity 2 — packageLinkTargets package-private

`installer-prepared-path-consumption.contract.test.ts` reaches
`packageLinkTargets` via `import * as installer from './installer.ts'`
(line 6/26) and asserts presence there (line 166) and absence from the package
root (line 167). Both halves GREEN in the batch above. Preservation carriers:
`installer.ts` keeps the symbol reachable via a forwarding re-export
(Acceptance 1), `src/index.ts` stays byte-identical (Acceptance 3), and the
namespace import line itself is FROZEN by Acceptance 5 — the retarget-to-
donor-module self-certification the attempt-1 tail flagged is closed by
declaration, checkable in the final diff.

## Parity 3 — ADR-0335 boundary coverage, BOTH inventories (RED)

Discriminating pairs via `evaluateRuntimeAdapterBoundary(tempRoot)` from
`tools/checks/runtime-adapter-boundary.mjs`: a temp root stubs every listed
generic + Sass-surface path with `export const ok = 1;`, then plants the
mutant at an UNLISTED extracted-module path vs a LISTED path.

Generic inventory — probe source (verbatim, also the attempt-1 live-gate
probe, then at `installer-red-probe.ts`, gate exit 0 with 17 modules
"consumer-branch-free"):

```ts
export function redProbeConsumerBranch(name: string): boolean {
  if (name === 'esbuild') return true;
  return false;
}
```

```
A) probe at UNLISTED packages/npm-client/src/eddy-fast-path.ts → []
B) same probe at LISTED packages/npm-client/src/installer.ts →
   ["packages/npm-client/src/installer.ts:2: consumer-specific runtime literal \"esbuild\""]
```

Provenance inventory — the generic scan flags identifiers only inside
control-flow conditions, so a runtime `sass*` identifier in plain expression
position is invisible to it and caught ONLY by the `registrySourceProvenance`
(genericChecks=false) scan. Mutant source (verbatim):

```ts
declare function resolveLauncher(name: string): string;
export const launcher = resolveLauncher('embedded');
export const sassLauncherPath = launcher;
```

```
A) mutant at UNLISTED packages/npm-client/src/installer-sources.ts → []
B) same content at LISTED packages/npm-client/src/registry.ts →
   ["packages/npm-client/src/registry.ts:3: consumer-specific runtime identifier \"sassLauncherPath\""]
```

Both silent passes ARE the defect row 3 rejects: an extracted module omitted
from the applicable list is never inspected. The row closes when
`GENERIC_RUNTIME_ADAPTER_MODULES` names every extracted module,
`registrySourceProvenance` additionally names the provenance carriers
(sources, walk, eddy fast path, shadow substitution), the frozen test mirrors
carry the same append-only entries, and the gate flags both planted mutants in
a listed module.

## Parity 4 — ratchet identity (full partition transcript)

Command: `node` against `evaluate()`/`BASELINE` from
`tools/checks/file-size.mjs` (THRESHOLD 800, RECORD_DELTA 150), measuring
`packages/npm-client/src/installer.ts` at each partition:

```
 3067 → grew 3066 → 3067 lines — grandfathered files may only shrink; …
 3066 → (silent — pin holds)
 3000 → (silent — pin holds)          ← RECORD_DELTA slack band (3066–2917)
 2917 → (silent — pin holds)          ← band edge
 2916 → shrank 3066 → 2916 lines — lower its BASELINE entry to 2916 …
  801 → shrank 3066 → 801 lines — lower its BASELINE entry to 801 …
  800 → down to 800 lines (at or under 800) — delete its BASELINE entry …
  691 → down to 691 lines (at or under 800) — delete its BASELINE entry …
 entry deleted, 691  → [] (OK)
 entry deleted, 3000 → 3000 lines — a new source file over 800 cannot be
                       read in one call … split it (AGENTS.md §Architecture)
 file absent, entry retained → BASELINE entry for a file that no longer
                       exists — delete it
```

So: with the entry DELETED (Acceptance 2), every over-800 outcome fails
loudly; the only silent partition is a partial extraction that keeps the old
pin inside its 150-line slack — there the surviving `BASELINE` entry is the
unit-open signal, and Acceptance 2 refuses it. Matches the re-cut Parity 4
declaration exactly.

## Acceptance 3 — public-surface manifest (base oracle)

`src/index.ts` at `686b650a4` re-exports from `./installer.ts` exactly:
`install` + types `InstallAcquisitionProvenance`, `InstallOptions`,
`InstallPackageProvenance`, `InstallProgressEvent`, `InstallResolution`,
`InstallResult`, `PackageTransport`, `PackumentCacheLike`; final oracle =
empty `git diff 686b650a4 -- packages/npm-client/src/index.ts`. `installer.ts`
exports at base (`rg -n '^export' packages/npm-client/src/installer.ts`):
values `install` (4 declarations, overloads), `packageLinkTargets`; the same
eight types; nothing else. The final tree must reproduce this manifest
byte-for-byte in meaning: same values, same types, no additions.

## Repo gates at baseline

`pnpm check:runtime-adapter-boundary` (17 modules + 7 Sass categories),
`pnpm check:file-size` (ratchet holds), `pnpm backlog:check` pass untouched.

## Settled carriers (agent altitude, §Refine altitude)

Recorded for the reviewer; the contract's §Context groups map to:
`eddy-fast-path.ts` (eddy group + `analyzeLockfileRequest`/ownership merge —
their only callers are the two Eddy gates), `installer-walk.ts`
(walk/placement + `lockfileReuseDecision` per contract §Decisions +
`rangeIsUnconstrained` + the shared resolution types
`ResolvedPin`/`ResolveContext`/`ResolutionSource`/`PinnedPackage`),
`installer-sources.ts`, `installer-request.ts` (root manifest + arg
validation), `installer-peers.ts` (peers/collisions),
`installer-bin-claims.ts` (bin claims + link targets — dedicated module, see
linker sizing fact above), `internal/shadow/substitution.ts` (shadow
substitution + shadow replay/embedded asserts — same owner per §Context;
also hosts the `pinnedShadowSubstitutions` side table, keyed by
`NormalizedResolvedPackage` so its only linker/walk references are erased
type edges), `utils/abort-signal.ts` (shared abort helpers). Runtime import
graph stays acyclic: every back-reference to `installer.ts` or between
donor modules is type-only, erased (`arch-rules.cjs` no-circular binds the
runtime graph). Ported coordination carries its forcing constraints in the
contract's §Decisions; nothing new is introduced.
