# installer-decomposition Contract+RED

## Baseline — 2026-08-29

Fresh source baseline is `main@686b650a402ef03ecd378a1df347623d5933ad91`.
Unit: `docs/backlog/npm-client/installer-decomposition.md` (ready, standalone —
no goal directory). Move-only: every Parity row pins preservation against this
baseline; no production source differs from it at this checkpoint.

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
  src/shadow-recipe-v2-data-authority.contract.test.ts
```

Result: **14 files, 374/374 GREEN**. The batch is the contract's 13 named
suites plus `shadow-recipe-v2-data-authority.contract.test.ts` — it also
imports `./installer.ts` (rg over `*.test.ts`), so its unedited pass is part of
the identity oracle. GREEN target after the move: same batch, same 374, with
only import-path edits permitted in test files (Acceptance 5).

## Parity 2 — packageLinkTargets package-private

`installer-prepared-path-consumption.contract.test.ts` reaches
`packageLinkTargets` via `import * as installer from './installer.ts'`
(line 26/166) and asserts `npmClientRoot` lacks it (line 167). Both halves
GREEN in the baseline batch above. Preservation carrier: after the move
`installer.ts` keeps the symbol reachable (re-export), `src/index.ts` still
does not export it.

## Parity 3 — ADR-0335 boundary silent pass (RED)

Probe: `packages/npm-client/src/installer-red-probe.ts` containing a concrete
consumer literal in a control-flow branch
(`if (name === 'esbuild') return true;`), NOT listed in
`GENERIC_RUNTIME_ADAPTER_MODULES`:

```
$ pnpm check:runtime-adapter-boundary
runtime-adapter-boundary: 17 generic modules and 7 Sass-forbidden categories consumer-branch-free
exit=0
```

The gate passes — the unlisted module is never inspected; that silent pass IS
the defect row 3 rejects. Discrimination control: the same file fed through
`runtimeAdapterBoundaryViolations()` directly reports
`installer-red-probe.ts:5: consumer-specific runtime literal "esbuild"` — so
listing every extracted module closes the row. Probe deleted after capture; it
never entered a commit.

## Parity 4 — ratchet identity (message evidence)

`evaluate()` from `tools/checks/file-size.mjs` against the live `BASELINE`:

- measured 691 lines → `installer.ts: down to 691 lines (at or under 800) —
  delete its BASELINE entry in this PR`
- measured 2800 lines → `installer.ts: shrank 3066 → 2800 lines — lower its
  BASELINE entry to 2800 in this PR so the burn-down cannot regrow`

Both acceptance signals are live in the gate at this baseline.

## Repo gates at baseline

`pnpm check:runtime-adapter-boundary` (17 modules), `pnpm check:file-size`
(ratchet holds, installer.ts pinned at 3066, current 3063) pass untouched.

## Settled carriers (agent altitude, §Refine altitude)

Recorded for the reviewer; the contract's §Context groups map to:
`eddy-fast-path.ts` (eddy group + `analyzeLockfileRequest`, whose only callers
are the two Eddy gates), `installer-walk.ts` (walk/placement group +
`lockfileReuseDecision` per contract §Decisions), `installer-sources.ts`,
`installer-request.ts` (root manifest + arg validation),
`installer-peers.ts` (peers/collisions), `internal/shadow/substitution.ts`
(shadow substitution + shadow replay/embedded asserts — same owner per
§Context), bin claims + link targets into `linker.ts` (per §Out of scope,
568 + ~216 stays under 800), shared abort helpers into
`utils/abort-signal.ts`. Shared private types travel with their owning group;
runtime import graph stays acyclic (cross-module back-references are
type-only, erased — `arch-rules.cjs` no-circular binds the runtime graph).
