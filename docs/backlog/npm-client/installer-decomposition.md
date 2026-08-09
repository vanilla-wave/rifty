---
area: npm-client
status: ready
title: Decompose installer.ts along its existing seams until it reads in one call
created: 2026-08-09
why: installer.ts is 3066 lines — 213 reads and 12.5% of every source-read token in a measured agent session, because no reader gets it in one call
user_story: As an agent fixing an install bug, I want the installer module to arrive in one read, but today `installer.ts` is 3066 lines (~27k tokens) against a hard 10k-token tool-output ceiling, so I walk it in overlapping line windows and pay for the same file four times per compaction cycle.
sources: [context audit of codex sessions 019fafee / 019fb000, ADR-0335, tools/checks/file-size.mjs]
code: [packages/npm-client/src/installer.ts]
---

## Context

`installer.ts` is the largest prod file in the repo and the most expensive one to
read. Measured over two full agent sessions (2026-07-29 → 08-04): 213 reads,
319k tokens = 12.5% of all source-read tokens, and 33 of those reads came back
truncated. Delivered tool output is capped at ~10 000 tokens regardless of what
the caller requests (max observed across ~5 800 calls: 10 056), so a 3066-line
file at the repo's median 35.9 chars/line (~27k tokens) can never arrive whole —
it is walked in windows, and a truncated window is re-fetched over the same range
in ~2 of 3 cases.

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
| bin claims + link targets (`packageLinkTargets`, `*BinSources`, claim keys, path asserts) | 692–882 | 191 | `linker.ts` already owns bin claims |
| shadow replay/embedded asserts | 1989–2053, 2577–2664 | 153 | same owner as shadow substitution |
| peers / collisions (`warnUnsatisfiedPeers`, collision + override predicates) | 3023–3066 | 44 | leaf diagnostics, no install state |

Sum extractable ≈ 2375 lines, leaving ≈ 691 in `installer.ts` — under the 800
threshold without a single arbitrary cut. Line numbers are the group extents at
`29f6eb06e`, not a prescription: follow what the code says if it has moved. One
boundary is genuinely ambiguous and is settled here rather than at pickup —
`chooseSource` (1729) goes with sources, `replayedShadowFact` (1768) with shadow
substitution, `lockfileReuseDecision` (1795) with the resolution walk.

## User scenario

An agent picks up an install-provenance bug in `@riftydev/npm-client`. It runs
`rg -n 'provenance' packages/npm-client/src`, gets hits in the installer, and
reads the enclosing region. Today that read returns a truncated window of a
3066-line file and the agent issues three more reads to see the surrounding
phase. After this unit the acquisition phase it needs is one module that arrives
whole in one call.

## Acceptance

1. `packages/npm-client/src/installer.ts` retains only the `install` overloads,
   their orchestration body, and the public types re-exported by
   `src/index.ts`. Every group in §Context lives in its own module under
   `packages/npm-client/src/` or `src/internal/`.
2. `pnpm check:file-size` passes with the `installer.ts` `BASELINE` entry
   **deleted** (the gate itself refuses a stale entry once the file is at or
   under 800 lines).
3. Package public surface is byte-identical: `src/index.ts` exports exactly
   `install` plus the same eight types, and no extracted symbol reaches the
   package root.
4. Every module extracted from `installer.ts` is added to
   `GENERIC_RUNTIME_ADAPTER_MODULES` in `tools/checks/runtime-adapter-boundary.mjs`
   — and to `SASS_FORBIDDEN_SURFACE.registrySourceProvenance` when it carries
   registry-source provenance. An extracted module absent from that list is
   silently outside the ADR-0335 boundary; that is the failure this row rejects.
5. No test file is edited to make the move pass. Import-path updates in test
   files are allowed; changes to any assertion, fixture, or test name are not.
6. `pnpm pr:check` green, including `check:arch` (no reverse imports, no cycles,
   no foreign `src/internal/*`) and `check:dir-owner` (`npm-client/src` is at 21
   direct prod modules against a threshold of 30 — the extraction has 9 slots
   before it owes an owner `README.md`).

## Parity cases

This unit ships no new observable behavior, so every row pins **preservation**.
The oracle is the pre-move suite at the base SHA; a fake or a rewritten
assertion cannot close any row.

1. **Install behavior identity** — the 13 suites importing `installer.ts`
   (`installer.test.ts`, `installer-pipeline`, `installer-lockfile`,
   `installer-concurrency`, `installer-native-policy`, `installer-peer-optional`,
   `installer-shadow-shims`, and the six `*.contract.test.ts` shadow/prepared-path
   suites) pass unedited before and after. RED target: run them against the base
   SHA first and keep that output as the comparison artifact.
2. **`packageLinkTargets` stays package-private** —
   `installer-prepared-path-consumption.contract.test.ts:165` asserts it is
   reachable through the installer module but absent from the package root. The
   move must preserve both halves; re-exporting it from `src/index.ts` is a
   regression this row catches.
3. **ADR-0335 boundary coverage** — RED target: add an extracted module and run
   `pnpm check:runtime-adapter-boundary` before listing it. The gate only
   inspects modules named in its list, so the module passes while uncovered —
   that silent pass IS the defect. The row closes when the list names every
   extracted module and the gate flags a planted concrete-package literal in one
   of them.
4. **Ratchet identity** — `pnpm check:file-size` fails with "delete its BASELINE
   entry" if the entry survives the shrink, and with "lower its BASELINE entry"
   if the file lands over 800 with the old number. Both messages are the
   acceptance signal, not a nuisance.

## Out of scope

- The other 47 pinned files —
  `docs/backlog/toolchain-build/oversized-source-burndown.md`.
- Any behavior change, bug fix, or API addition found while moving code: capture
  via `rifty-to-backlog`, do not fold it in. A move-only diff is what makes row 1
  checkable.
- Splitting `linker.ts` (568 lines, under threshold) even though it gains the bin
  claim group — if that push takes it over 800 it needs its own unit, not a
  silent second decomposition here.
- Introducing a new coordination mechanism to bridge the extracted modules.
  Nothing here needs one; if the code appears to, that is a §Class-kill sweep and
  an ADR, not part of this unit.

## Decisions

- **Where the seams run is settled here, from code, not left to pickup.** The
  groups in §Context are contiguous top-level declaration ranges with single
  entry points, and each destination is an existing named family in the same
  package (`eddy-*.ts`, `internal/shadow/`, `linker.ts`) — not an invented layer.
  Per §Refine altitude this is a carrier the agent owns; it is recorded rather
  than deferred so pickup does not re-litigate it.
- **Acceptance is defined by responsibility, with the line count as its
  consequence** — not the reverse. Splitting to hit 800 would ship exactly the
  speculative layering §Simplicity forbids. The arithmetic (2375 extractable,
  691 remaining) is evidence that the honest seams suffice, not the target.
- **Review convergence applies.** `installer.ts` owns cache, network,
  persistence, and concurrency paths, so per `fault-classes.md` §Review
  convergence this unit takes Contract+RED before implementation and Final+GREEN
  on one SHA — even though the diff is move-only.
- **No `## Fault matrix`.** A move-only unit reaches no new axis × operation; the
  existing fault suites (`registry.fault.test.ts`,
  `internal/shadow/source.fault.test.ts`) keep their coverage and are part of
  row 1. Should any extraction turn out to require a behavior change, that is a
  fork: stop, demote to `draft` recording the fork and this Acceptance verbatim
  (§Backlog readiness 5).
- **Order is free.** The groups are independent; an agent may extract them in any
  order, but the unit closes only when `installer.ts` reaches the shape in
  Acceptance 1 — a partial extraction leaves the `BASELINE` entry lowered and the
  unit open.
