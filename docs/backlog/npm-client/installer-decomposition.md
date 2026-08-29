---
area: npm-client
status: draft
title: Decompose installer.ts along its existing seams until it reads in one call
created: 2026-08-09
why: installer.ts is 3066 lines — 213 reads and 12.5% of every source-read token in a measured agent session, because no reader gets it in one call
user_story: As an agent fixing an install bug, I want the installer module to arrive in one read, but today `installer.ts` is 3066 lines (~27k tokens) against a hard 10k-token tool-output ceiling, so I walk it in overlapping line windows and pay for the same file four times per compaction cycle.
sources: [context audit of codex sessions 019fafee / 019fb000, ADR-0335, tools/checks/file-size.mjs, reference/installer-decomposition-contract-red.md]
code: [packages/npm-client/src/installer.ts]
---

## Context

`installer.ts` is the largest prod file in the repo and the most expensive one to
read. Measured over two full agent sessions (2026-07-29 → 08-04): 213 reads,
319k tokens = 12.5% of all source-read tokens, and 33 of those reads came back
truncated. Delivered tool output is capped at ~10 000 tokens regardless of what
the caller requests (max observed across ~5 800 calls: 10 056), so a 3064-line
file (gate measure at `686b650a4`) at the repo's median 35.9 chars/line (~27k
tokens) can never arrive whole — it is walked in windows, and a truncated
window is re-fetched over the same range in ~2 of 3 cases.

`pnpm check:file-size` pins the file at 3066 and refuses growth. This unit
removes the pin.

The seams already exist in the file; this is not a new layering. Measured
top-level declaration groups, contiguous and single-entry:

| Group | Lines | Size | Destination evidence |
|---|---|---|---|
| eddy fast path (`tryEddyFastPath`, `consumeEddyResponse`, `declineEddy`, `existingLockfilePreemptsEddy`) | 1092–1547 | 456 | 5 sibling `eddy-*.ts` modules already in `src/` |
| walkAndPin + placement (`walkAndPin`, `pinToPackage`, `choosePlacement`, `translateRecordedInstallPath`, `warnOptional`) | 2054–2576 | 523 | resolution is a distinct phase from acquisition |
| sources (`createLockfileSource`, `createRegistrySource`, `assertNativeSupported`) | 2665–3022 | 358 | `createIncrementalSource`/`chooseSource` already name a source abstraction |
| shadow substitution (recipes, projections, synthetic manifests) | 1548–1800 | 253 | `src/internal/shadow/` already owns shadow mechanics |
| root manifest + arg validation (`normalizeInstallArgs`, `readRootPackageJson`, override/spec/lifecycle asserts) | 883–1091 | 209 | pure input validation, no install state |
| bin claims + link targets (`packageLinkTargets`, `*BinSources`, claim keys, path asserts) | 692–882 | 191 | `linker.ts` names the bin-claim family; sizing forces a dedicated module (§Decisions) |
| shadow replay/embedded asserts | 1989–2053, 2577–2664 | 153 | same owner as shadow substitution |
| peers / collisions (`warnUnsatisfiedPeers`, collision + override predicates) | 3023–3066 | 44 | leaf diagnostics, no install state |

Sum extractable ≈ 2187 lines by the table; with each group's private types and
shed imports leaving alongside, the orchestrator lands well under the 800
threshold without a single arbitrary cut. Line numbers are the group extents at
`29f6eb06e`, not a prescription: follow what the code says if it has moved
(`translateRecordedInstallPath`, `warnOptional`, `assertNativeSupported`
already live in `installer-lockfile-replay.ts` at `686b650a4`). One boundary is
genuinely ambiguous and is settled here rather than at pickup — `chooseSource`
goes with sources, `replayedShadowFact` with shadow substitution,
`lockfileReuseDecision` with the resolution walk.

## User scenario

An agent picks up an install-provenance bug in `@riftydev/npm-client`. It runs
`rg -n 'provenance' packages/npm-client/src`, gets hits in the installer, and
reads the enclosing region. Today that read returns a truncated window of a
3064-line file and the agent issues three more reads to see the surrounding
phase. After this unit the acquisition phase it needs is one module that arrives
whole in one call.

## Acceptance

1. `packages/npm-client/src/installer.ts` retains only the `install` overloads,
   their orchestration body, the public types re-exported by `src/index.ts`,
   and the Parity-2 forwarding re-export of `packageLinkTargets`. Every group
   in §Context lives in its own module under `packages/npm-client/src/` or
   `src/internal/`.
2. `pnpm check:file-size` passes with the `installer.ts` `BASELINE` entry
   **deleted** (with the entry deleted, every over-800 outcome fails loudly as
   a new oversized file — see Parity 4 partitions).
3. Package public surface is byte-identical: `src/index.ts` is unchanged
   (byte-diff empty vs `686b650a4`), and `installer.ts` exports exactly the
   base manifest — values `install`, `packageLinkTargets`; types
   `PackumentCacheLike`, `InstallOptions`, `InstallProgressEvent`,
   `InstallResolution`, `PackageTransport`, `InstallPackageProvenance`,
   `InstallAcquisitionProvenance`, `InstallResult` — and nothing else. No
   extracted symbol reaches the package root.
4. Every module extracted from `installer.ts` is added to
   `GENERIC_RUNTIME_ADAPTER_MODULES` in `tools/checks/runtime-adapter-boundary.mjs`
   — and to `SASS_FORBIDDEN_SURFACE.registrySourceProvenance` when it carries
   registry-source provenance (the source, walk, eddy, and shadow-substitution
   carriers do; arg validation and leaf diagnostics do not). A module absent
   from every applicable list is silently outside the ADR-0335 boundary; that
   is the failure Parity 3 rejects behaviorally. Provenance membership for a
   GENERIC-listed module is a DECLARATION obligation, not a behavioral one:
   `SASS_FORBIDDEN_SURFACE.catalogConsumers` aliases the whole GENERIC array,
   so every GENERIC-listed module already receives the Sass scan and
   provenance-list omission cannot be isolated by any mutant — its oracle is
   list content plus mirror-array equality
   (`tools/checks/runtime-adapter-boundary.test.ts:69,74`), checked in review.
   The frozen mirror arrays are extended with exactly the same entries
   (Acceptance 5 carve-out).
5. No behavior test is edited to make the move pass. Import-path updates in
   test files are allowed, EXCEPT the frozen module-identity carrier
   `import * as installer from './installer.ts'` in
   `installer-prepared-path-consumption.contract.test.ts` — retargeting it
   would self-certify Parity 2. Changes to any assertion, fixture, or test
   name are not allowed, with ONE carve-out forced by Acceptance 4: the two
   frozen mirror arrays (`EXPECTED_GENERIC_RUNTIME_ADAPTER_MODULES`,
   `EXPECTED_SASS_FORBIDDEN_SURFACE.registrySourceProvenance`) in
   `tools/checks/runtime-adapter-boundary.test.ts` receive APPEND-ONLY entries
   for the extracted modules — the same additions as the check's own lists, no
   removals, no other edits. Without this carve-out Acceptance 4 (add to
   inventories), Acceptance 5 (no fixture edits), and Acceptance 6 (that test
   runs inside `pr:check` → `test:run`) are jointly unsatisfiable — recorded
   in §Demotion record.
6. `pnpm pr:check` green, including `check:arch` (no reverse imports, no
   runtime cycles, no foreign `src/internal/*`) and `check:dir-owner`
   (`npm-client/src` holds 21 direct prod modules at `686b650a4` against a
   threshold of 30 — the extraction adds at most 7 direct modules, staying
   under the owner-README trigger).

## Parity cases

This unit ships no new observable behavior, so every row pins **preservation**.
The oracle is the pre-move suite at the base SHA; a fake or a rewritten
assertion cannot close any row.

1. **Install behavior identity** — the 18-suite batch recorded in
   `reference/installer-decomposition-contract-red.md` §Parity 1 (the 13
   installer-importing suites originally named, plus
   `shadow-recipe-v2-data-authority.contract.test.ts` and
   `internal/shadow/installer.contract.test.ts` — the two remaining direct
   `./installer.ts` importers — plus the fault floors `registry.fault.test.ts`
   and `internal/shadow/source.fault.test.ts`, plus
   `installer-package-bin-normalization.contract.test.ts` covering the moved
   bin/link path) passes unedited before and after with identical test counts.
   RED target: the batch ran against the base SHA first; its output is the
   comparison artifact.
2. **`packageLinkTargets` stays package-private** —
   `installer-prepared-path-consumption.contract.test.ts:165` asserts it is
   reachable through the installer module (namespace import of
   `./installer.ts`, frozen by Acceptance 5) and absent from the package root.
   The move must preserve both halves; re-exporting it from `src/index.ts`, or
   retargeting the namespace import, is a regression this row catches.
3. **ADR-0335 boundary coverage** — RED targets recorded in the reference doc
   with runnable harness commands and tool versions: (a) generic — an
   extracted module carrying a concrete consumer literal in a control-flow
   branch passes the gate while listed in NO inventory and is flagged once
   listed in `GENERIC_RUNTIME_ADAPTER_MODULES`; (b) Sass-scan reach — a
   runtime `sass*` identifier outside control flow is invisible to the
   generic scan and caught only by the Sass scan, which reaches a module via
   `registrySourceProvenance` OR via the `catalogConsumers` alias of the
   GENERIC array — so the behavioral hole is a module in NEITHER list, and
   provenance-list membership for GENERIC-listed modules is the Acceptance-4
   declaration obligation with a structural oracle (list content + mirror
   equality), not a mutant target. The row closes when every extracted module
   is GENERIC-listed, the provenance carriers are additionally declared in
   `registrySourceProvenance`, both frozen mirrors carry the same entries,
   and the gate flags both planted mutants in a listed module.
4. **Ratchet identity** — full `evaluate()` partition at the base `BASELINE`
   (transcript + runnable command in the reference doc): 3067 → grew-refusal;
   3066–2917 with the old pin → SILENT (the `RECORD_DELTA = 150` slack band —
   a partial extraction inside it emits no message; the unit-open signal there
   is the surviving `BASELINE` entry itself, which Acceptance 2 forbids);
   2916–801 → "lower its BASELINE entry"; ≤800 with the entry retained →
   "delete its BASELINE entry"; entry deleted + >800 → loud new-oversized-file
   refusal; entry deleted + ≤800 → OK; entry retained + file gone → stale-entry
   refusal. The delete/lower messages plus the deleted-entry loud refusal are
   the acceptance signals.

## Out of scope

- The other 47 pinned files —
  `docs/backlog/toolchain-build/oversized-source-burndown.md`.
- Any behavior change, bug fix, or API addition found while moving code: capture
  via `rifty-to-backlog`, do not fold it in. A move-only diff is what makes row 1
  checkable.
- `linker.ts` is NOT touched: at the frozen base it is 604 gate-lines, so
  absorbing the 191-line bin-claim group would breach the 800 threshold —
  the group gets its own module instead (§Decisions). Splitting `linker.ts`
  stays its own unit if ever needed, never a silent second decomposition here.
- Introducing a new coordination mechanism to bridge the extracted modules.
  Nothing here needs one; if the code appears to, that is a §Class-kill sweep and
  an ADR, not part of this unit.

## Decisions

- **Where the seams run is settled here, from code, not left to pickup.** The
  groups in §Context are contiguous top-level declaration ranges with single
  entry points, and each destination is an existing named family in the same
  package (`eddy-*.ts`, `internal/shadow/`) — not an invented layer. Per
  §Refine altitude the module names are a carrier the agent owns; recorded so
  pickup does not re-litigate: `eddy-fast-path.ts` (also receives
  `analyzeLockfileRequest` + ownership merge — their only callers are the two
  Eddy gates), `installer-walk.ts` (+ `lockfileReuseDecision`,
  `rangeIsUnconstrained`, shared resolution types), `installer-sources.ts`,
  `installer-request.ts`, `installer-peers.ts`, `installer-bin-claims.ts`,
  `internal/shadow/substitution.ts` (substitution + replay/embedded asserts —
  same owner per §Context), `utils/abort-signal.ts` (shared abort helpers).
- **Bin claims + link targets get a dedicated `installer-bin-claims.ts`, not
  `linker.ts`.** Forcing fact (2026-08-29, live gate measure): `linker.ts` is
  604 lines at `686b650a4`; +191 group lines + imports ≈ 800+ breaches the
  threshold `linker.ts` is not grandfathered for. Acceptance 1's
  every-group-its-own-module wording applies literally; `linker.ts` stays the
  family evidence, not the carrier.
- **Ported coordination re-states its forcing constraints (no new mechanism
  anywhere in this unit):** the walk's `Semaphore(FETCH_CONCURRENCY)` bounds
  parallel tarball fetches (perf knob; any value yields the identical tree —
  proven by `installer-concurrency.test.ts`); the per-identity `inFlight` map
  collapses concurrent same-package acquisitions to one network call
  (provenance correctness); `createRegistrySource`'s packument semaphore +
  in-flight map bound and dedupe packument fetches; `pinnedShadowSubstitutions`
  is an identity-keyed side table tying a pinned package to its attested
  shadow fact without widening the linker-visible package shape — single
  writer `pinToPackage`, readers orchestration + bin-claim assembly. All four
  are live on `main` with unchanged callers; none is added or removed.
- **Acceptance is defined by responsibility, with the line count as its
  consequence** — not the reverse. Splitting to hit 800 would ship exactly the
  speculative layering §Simplicity forbids. The group arithmetic is evidence
  that the honest seams suffice, not the target.
- **Review convergence applies.** `installer.ts` owns cache, network,
  persistence, and concurrency paths, so per `fault-classes.md` §Review
  convergence this unit takes Contract+RED before implementation and Final+GREEN
  on one SHA — even though the diff is move-only.
- **No `## Fault matrix`.** A move-only unit reaches no new axis × operation;
  the AGENTS.md DoD row binds newly-touched fault surface, and the attempt-1
  adjudication ruled the matrix demand STRETCH for this unit ("neither clearly
  mandates an axis × operation enumeration for a move-only unit … whose
  existing fault suites stay unedited and green"). The attempt-2 re-cut
  volunteered a matrix anyway and thereby manufactured mutant-grade
  discrimination obligations (cancellation spies, completion-order inversion,
  mutation ledgers, adoption mutants) that no existing suite carries and that
  a move-only unit cannot honestly add — new fault tests are new
  behavior-verification work, exactly what §Out of scope excludes. The fault
  floors remain what they were on `main`: `registry.fault.test.ts` (8/8),
  `internal/shadow/source.fault.test.ts`, and every fault row inside the
  18-suite Parity-1 batch, frozen bit-for-bit as preservation oracles — their
  depth is main's depth, deepening them is its own backlog item, never a
  checkpoint condition here. Shared mutable state moved by this unit keeps its
  single writer: `pinnedShadowSubstitutions` is written only by `pinToPackage`
  (walk), read by orchestration and bin-claim assembly. Should any extraction
  turn out to require a behavior change, that is a fork: stop, demote to
  `draft` recording the fork and this Acceptance verbatim (§Backlog
  readiness 5).
- **Order is free.** The groups are independent; an agent may extract them in
  any order, but the unit closes only when `installer.ts` reaches the shape in
  Acceptance 1 — a partial extraction leaves either the `BASELINE` entry (or
  its lowered form) in place, or a loud oversized-file refusal (Parity 4), and
  the unit open.

## Demotion record — 2026-08-29

Demoted `ready → draft` at Contract+RED attempt 1 (checkpoint tree
`0af1f503d`, find + tail + adjudication): five HOLDS blockers — (1) Acceptance
4/5/6 were jointly unsatisfiable: `tools/checks/runtime-adapter-boundary.test.ts:69,74`
freeze both inventories with `toEqual`, Acceptance 4 forces inventory
additions, pre-demotion Acceptance 5 categorically forbade fixture edits, and
Acceptance 6 runs that test via `pr:check → test:run`; (2) the recorded linker
carrier relied on stale sizing (568 + ~216 < 800) — the live base linker is
604 gate-lines, so the prescribed carrier was a frozen assumption; (3) Parity 4
claimed the lower-message fires "if the file lands over 800 with the old
number" — false inside the `RECORD_DELTA` 150-line slack band (3066–2917
silent); (4) the Parity-1 batch omitted `internal/shadow/installer.contract.test.ts`
(a direct installer importer) and the two fault floors the contract itself
made part of row 1; (5) the boundary RED covered only the generic inventory —
the `registrySourceProvenance` half had no discriminating carrier. The re-cut
above resolves all five; the mirror-array carve-out in Acceptance 5 is
append-only and narrower than any alternative reading. Pre-demotion Acceptance
and Parity, verbatim:

> ## Acceptance
>
> 1. `packages/npm-client/src/installer.ts` retains only the `install` overloads,
>    their orchestration body, and the public types re-exported by
>    `src/index.ts`. Every group in §Context lives in its own module under
>    `packages/npm-client/src/` or `src/internal/`.
> 2. `pnpm check:file-size` passes with the `installer.ts` `BASELINE` entry
>    **deleted** (the gate itself refuses a stale entry once the file is at or
>    under 800 lines).
> 3. Package public surface is byte-identical: `src/index.ts` exports exactly
>    `install` plus the same eight types, and no extracted symbol reaches the
>    package root.
> 4. Every module extracted from `installer.ts` is added to
>    `GENERIC_RUNTIME_ADAPTER_MODULES` in `tools/checks/runtime-adapter-boundary.mjs`
>    — and to `SASS_FORBIDDEN_SURFACE.registrySourceProvenance` when it carries
>    registry-source provenance. An extracted module absent from that list is
>    silently outside the ADR-0335 boundary; that is the failure this row rejects.
> 5. No test file is edited to make the move pass. Import-path updates in test
>    files are allowed; changes to any assertion, fixture, or test name are not.
> 6. `pnpm pr:check` green, including `check:arch` (no reverse imports, no cycles,
>    no foreign `src/internal/*`) and `check:dir-owner` (`npm-client/src` is at 21
>    direct prod modules against a threshold of 30 — the extraction has 9 slots
>    before it owes an owner `README.md`).
>
> ## Parity cases
>
> This unit ships no new observable behavior, so every row pins **preservation**.
> The oracle is the pre-move suite at the base SHA; a fake or a rewritten
> assertion cannot close any row.
>
> 1. **Install behavior identity** — the 13 suites importing `installer.ts`
>    (`installer.test.ts`, `installer-pipeline`, `installer-lockfile`,
>    `installer-concurrency`, `installer-native-policy`, `installer-peer-optional`,
>    `installer-shadow-shims`, and the six `*.contract.test.ts` shadow/prepared-path
>    suites) pass unedited before and after. RED target: run them against the base
>    SHA first and keep that output as the comparison artifact.
> 2. **`packageLinkTargets` stays package-private** —
>    `installer-prepared-path-consumption.contract.test.ts:165` asserts it is
>    reachable through the installer module but absent from the package root. The
>    move must preserve both halves; re-exporting it from `src/index.ts` is a
>    regression this row catches.
> 3. **ADR-0335 boundary coverage** — RED target: add an extracted module and run
>    `pnpm check:runtime-adapter-boundary` before listing it. The gate only
>    inspects modules named in its list, so the module passes while uncovered —
>    that silent pass IS the defect. The row closes when the list names every
>    extracted module and the gate flags a planted concrete-package literal in one
>    of them.
> 4. **Ratchet identity** — `pnpm check:file-size` fails with "delete its BASELINE
>    entry" if the entry survives the shrink, and with "lower its BASELINE entry"
>    if the file lands over 800 with the old number. Both messages are the
>    acceptance signal, not a nuisance.

No observable scope changed in the re-cut: the same suites plus strictly more
of them pin row 1; rows 2–4 gained discrimination, not different behavior; the
carve-out permits only the append the pre-demotion contract already required
via its own row 3 ("The row closes when the list names every extracted
module").

**Attempt-2 re-refine (2026-08-29, §Contract escalation — 2nd consecutive
Contract+RED blocker, checkpoint tree `7626d25ae`):** the verify pass blocked
on (a) the attempt-2-volunteered `## Fault matrix`, whose rows demanded
mutant-grade fault discrimination (cancellation spies, completion-order
inversion, VFS mutation ledgers, Eddy adoption mutants) beyond anything the
frozen suites carry and one mis-mapped carrier (`source.fault.test.ts` asserts
`ESHADOWASSET` acquisition faults, not pinned-replay `EBROKENLOCK` — that row
lives in `installer-shadow-recipe-v2-replay-authority.contract.test.ts`); (b)
evidence-precision gaps (artifact claimed Vitest 4, actual 2.1.9; boundary and
ratchet transcripts lacked runnable commands/versions; the pre-demotion Parity
preamble was omitted from this record); (c) a frozen-assumption in Parity 3:
`SASS_FORBIDDEN_SURFACE.catalogConsumers` aliases the GENERIC array, so
provenance-list omission for a GENERIC-listed module is not behaviorally
isolable. Re-refined in place: the matrix is withdrawn (restoring the
adjudicated attempt-1 STRETCH position — fault floors stay preservation
oracles inside the Parity-1 batch at main's depth), Acceptance 4 / Parity 3
now declare the alias fact and a structural oracle for provenance membership,
the demotion record is verbatim-complete, and every transcript carries its
exact runnable command and tool versions. No pre-demotion observable
obligation weakened; deepening the fault suites is separate backlog work,
routed via `rifty-to-backlog`, not this unit.
