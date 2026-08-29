# installer-decomposition Contract+RED

## Baseline — 2026-08-29 (re-refined after attempt-2 escalation)

Fresh source baseline is `main@686b650a402ef03ecd378a1df347623d5933ad91`.
Unit: `docs/backlog/npm-client/installer-decomposition.md` (standalone — no
goal directory). Move-only: every Parity row pins preservation against this
baseline; no production source differs from it at this checkpoint. Lineage:
attempt-1 checkpoint tree `0af1f503d` blocked (find + tail + adjudication:
5 HOLDS, 3 STRETCH → concerns, 1 FALSE); attempt-2 verify on re-cut tree
`7626d25ae` blocked again → §Contract escalation re-refine in place (the
item's §Demotion record carries both attempts and the pre-demotion contract
verbatim). This document is the attempt-3 evidence.

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

Result: **18 files, 404/404 GREEN** (Vitest 2.1.9, Node v24.16.0,
darwin-arm64). Composition:
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

## Parity 3 — ADR-0335 boundary coverage (RED)

Runnable harness (Node v24.16.0, typescript 5.9.3 — the parser the gate
itself uses; run from the repo root): build a temp root stubbing every listed
generic + Sass-surface path with `export const ok = 1;`, plant the mutant,
call `evaluateRuntimeAdapterBoundary(tempRoot)`:

```sh
node -e "
const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
const { join, dirname } = await import('node:path');
const os = await import('node:os');
const { evaluateRuntimeAdapterBoundary, GENERIC_RUNTIME_ADAPTER_MODULES, SASS_FORBIDDEN_SURFACE } = await import('./tools/checks/runtime-adapter-boundary.mjs');
const root = mkdtempSync(join(os.tmpdir(), 'boundary-red-'));
const stub = 'export const ok = 1;\n';
for (const f of GENERIC_RUNTIME_ADAPTER_MODULES) { mkdirSync(join(root, dirname(f)), {recursive:true}); writeFileSync(join(root, f), stub); }
for (const [cat, paths] of Object.entries(SASS_FORBIDDEN_SURFACE)) {
  if (cat === 'catalogConsumers') continue;
  for (const p of paths) {
    if (/\\.[cm]?[jt]sx?\$/.test(p)) { mkdirSync(join(root, dirname(p)), {recursive:true}); writeFileSync(join(root, p), stub); }
    else mkdirSync(join(root, p), {recursive:true});
  }
}
const mutant = process.argv[1];
writeFileSync(join(root, process.argv[2]), mutant);
console.log(JSON.stringify(evaluateRuntimeAdapterBoundary(root)));
" "<mutant source>" "<repo-relative plant path>"
```

Generic-scan mutant — probe source (verbatim; also the attempt-1 live-gate
probe, then at `installer-red-probe.ts`: `pnpm check:runtime-adapter-boundary`
exited 0, "17 generic modules … consumer-branch-free"):

```ts
export function redProbeConsumerBranch(name: string): boolean {
  if (name === 'esbuild') return true;
  return false;
}
```

```
A) probe at packages/npm-client/src/eddy-fast-path.ts (in NO inventory) → []
B) same probe at packages/npm-client/src/installer.ts (GENERIC-listed) →
   ["packages/npm-client/src/installer.ts:2: consumer-specific runtime literal \"esbuild\""]
```

Sass-scan mutant — the generic scan flags identifiers only inside
control-flow conditions, so a runtime `sass*` identifier in plain expression
position is invisible to it and caught only by the Sass scan
(genericChecks=false). Mutant source (verbatim):

```ts
declare function resolveLauncher(name: string): string;
export const launcher = resolveLauncher('embedded');
export const sassLauncherPath = launcher;
```

```
A) mutant at packages/npm-client/src/installer-sources.ts (in NO inventory) → []
B) same content at packages/npm-client/src/registry.ts (registrySourceProvenance-listed,
   NOT GENERIC-listed) →
   ["packages/npm-client/src/registry.ts:3: consumer-specific runtime identifier \"sassLauncherPath\""]
```

Both A-silences ARE the defect row 3 rejects: a module in NO inventory is
never inspected. Scan-reach fact (frozen-assumption killed at attempt-2
verify): `SASS_FORBIDDEN_SURFACE.catalogConsumers` aliases the whole
`GENERIC_RUNTIME_ADAPTER_MODULES` array, so every GENERIC-listed module
already receives the Sass scan — a mutant CANNOT distinguish
"GENERIC-listed + provenance-omitted" from "GENERIC-listed +
provenance-listed" (both flag pair-B-style). Provenance-list membership for
the extracted carriers (sources, walk, eddy fast path, shadow substitution)
is therefore the Acceptance-4 declaration obligation with a structural
oracle: list content in the check + mirror equality asserted by
`tools/checks/runtime-adapter-boundary.test.ts:69,74`. The row closes when
every extracted module is GENERIC-listed, provenance carriers are declared in
`registrySourceProvenance`, both frozen mirrors carry the same append-only
entries, and the gate flags both planted mutants in a listed module.

## Parity 4 — ratchet identity (full partition transcript)

Runnable command (Node v24.16.0, from the repo root; THRESHOLD 800,
RECORD_DELTA 150 in `tools/checks/file-size.mjs` at `686b650a4`):

```sh
node -e "
const { evaluate, BASELINE } = await import('./tools/checks/file-size.mjs');
const f = 'packages/npm-client/src/installer.ts';
for (const lines of [3067, 3066, 3000, 2917, 2916, 801, 800, 691]) {
  const v = evaluate([{file:f, lines}], BASELINE).filter(x=>x.includes('installer.ts'));
  console.log(String(lines).padStart(5), '→', v.length ? v[0] : '(silent — pin holds)');
}
const del = BASELINE.filter(e=>e.file!==f);
console.log('entry deleted, 691 →', JSON.stringify(evaluate([{file:f, lines:691}], del).filter(x=>x.includes('installer.ts'))));
console.log('entry deleted, 3000 →', JSON.stringify(evaluate([{file:f, lines:3000}], del).filter(x=>x.includes('installer.ts'))));
console.log('file absent, entry retained →', JSON.stringify(evaluate([], BASELINE).filter(x=>x.includes('installer.ts'))));
"
```

Output transcript:

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
