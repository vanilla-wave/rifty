---
area: distribution
status: draft
title: Make checkSandboxSupport gate-ready for a real non-COI SDK host before PR #340 lands
created: 2026-09-15
why: A real non-COI SDK host ran the PR #340 report and found two gate hazards (unconfigured assets read as browser verdict; mode reasons not addressable by id) plus four guide gaps; the API is unpublished, so its shape is still free to change.
user_story: As a bundler-built web app opening the non-COI SDK toolchain, I want one conclusion plus the rows relevant to my composition to gate sandbox opening, but today a forgotten probeBaseUrl yields `inconclusive` with unexplained rows and `reasons` are strings I cannot map back to checks.
sources: [reference/workbench-sandbox-support-consumer-evidence.md, reference/workbench-sandbox-support-consumer-challenge.md, https://github.com/vanilla-wave/rifty/pull/340, ADR-0437, ADR-0007]
code: [packages/workbench/src/support/check-sandbox-support.ts, packages/workbench/src/support/report.ts, packages/workbench/src/support/types.ts, docs/public/sandbox-support.md, tests/browser-unit/sandbox-support.spec.ts, packages/service-worker/src/register.ts, packages/rifty/src/sandbox.ts]
---

## Context

Finding shape. Observed on Chrome 152 / macOS by a bundler-built non-COI SDK host
(`createSandbox({ requireCrossOriginIsolation: false, skipServiceWorker: true,
toolchain, storage: { persistence: 'required' } })` plus its own origin Web Lock),
running `packages/workbench/src/support/*` built from PR #340 head `f63da13f9`
(`reference/workbench-sandbox-support-consumer-evidence.md`):

- Confirmed value: with `probeBaseUrl` the report is honest and complete
  (`nonCoi: supported`, `coi: unsupported` on exactly `cross-origin-isolated` +
  `shared-memory`, 15/18 passed, `cleanup: passed`), 10–32 ms per call, live
  session untouched (same held lease, 0 leftover registrations, no probe
  directories). Same-origin `probeBaseUrl` matched the host's existing worker
  directory; no packaging workaround needed.
- B: without `probeBaseUrl`, `nonCoi` is `inconclusive` with 12 `incomplete` rows
  and only `module-worker` explaining why; `check-sandbox-support.ts:399-411`
  labels three rows, eight keep the seed text at `:55`; the deadline rewrite at
  `:414-422` can relabel never-started rows as "probe deadline expired". A gate
  cannot tell host misconfiguration from a browser verdict.
- D: `modes.*.reasons` / `limitations` are `string[]`; surfaced reasons at
  `check-sandbox-support.ts:168, 247, 320, 330` carry no id prefix, so a UI
  cannot map them to `checks` rows or filter them.
- A: `page-locks` is absent from `nonCoi.required` while the host needs Web Locks.
  Verified: the SDK non-COI composition uses no Web Locks (`navigator.locks` only
  in `open-workbench.ts` / `browser-workbench-composition.ts`, COI); the lock is
  the host's own prerequisite, so the report is correct for the composition.
- C: SW rows are noise for a `skipServiceWorker` host. Verified: the SDK non-COI
  default registers a module SW (`packages/service-worker/src/register.ts:40`
  `type ?? 'module'`, `packages/rifty/src/sandbox.ts:677`), so
  `service-worker-module-registration` mirrors a real composition and stays; the
  in-session inline review remark of 2026-09-15 that no composition registers a
  module SW (recorded only in the consumer evidence, lines 115-117) was wrong.
- Guide gaps: when `wasm: true` is mandatory for non-COI; how a gate treats
  `inconclusive`; how a host adds its own prerequisites; that `skipServiceWorker`
  hosts ignore SW rows.

## Challenge

challenge: 2026-09-15 — 3 problems (record: `reference/workbench-sandbox-support-consumer-challenge.md`)

- P1 HOLDS: SDK non-COI default registers a module SW; module-SW row stays.
- P2 HOLDS: F1–F4 are agent-owned API/carrier decisions (refine delegated the
  public signature to PICKUP); no user fork, recorded below.
- P3 HOLDS: a reason-text-only fix must reseed the eight never-started rows;
  resolved by removing the omission branch instead.

## User scenario

Real host above. Call `checkSandboxSupport({ probeBaseUrl: '/<worker-dir>/',
persistence: 'required' })` on a `crossOriginIsolated: false` page with a live
sandbox and held origin lease. Expected: `modes.nonCoi.conclusion === 'supported'`
with empty unmet ids, `modes.coi.conclusion === 'unsupported'` with unmet ids
`['cross-origin-isolated', 'shared-memory']`, each id resolving to a `checks`
row, cleanup passed, lease/registrations/OPFS unchanged. Call without
`probeBaseUrl`: a thrown `TypeError` naming the option, no report, no probe
started.

## Acceptance

1. `checkSandboxSupport()` without `probeBaseUrl` throws `TypeError` naming the option before any probe starts; no `incomplete`-because-unconfigured row exists anywhere in the report; `docs/public/sandbox-support.md:40-41` and the `types.ts:39` comment no longer describe an omission path → scenario
2. `modes.coi` / `modes.nonCoi` expose `unmet` and `limitations` as `readonly SandboxSupportCheckId[]`; every id resolves to exactly one `checks` row; the host's scenario line is built from `conclusion` + those rows without string parsing → scenario
3. `docs/public/sandbox-support.md` states: host-own prerequisites are composed from `checks` (Web Lock example); `wasm: true` is mandatory for non-COI when programs use `node:sqlite`, WASI binaries or `vmEngine: 'quickjs'`; `inconclusive` after 1. means deadline or occupied private name only (retry / inspect, never a browser verdict); `skipServiceWorker` hosts ignore SW rows → scenario
4. RED first for 1–2 in `tests/browser-unit/sandbox-support.spec.ts` (`missing probe configuration` becomes the throw case; `.join(' ')` reason matches become id assertions); the existing native suite stays green → scenario
5. Public seam recorded per DEC-2: new short ADR citing ADR-0437, dated §Corrections note in ADR-0437 pointing at it (decision 2 "omission reports incomplete" overturned; decision 1 report sections unchanged) → ADR-0437

## Out of scope

- `page-locks` in `nonCoi.required`: the SDK composition needs no lock (ADR-0437 §3).
- `require:` option folding host-own ids into a conclusion; `serviceWorker: false`
  opt-out: preferred extra features, composition from `checks` suffices (REV-7).
- Dropping the module-SW probe: SDK non-COI registers a module SW by default.
- Safari / Firefox behavior: non-Chromium browsers are a stated non-goal (AGENTS.md §Mission; ADR-0007 keeps them best-effort).
- Playground adopting `checkSandboxSupport`: not raised by this host; separate question.

## Decisions

- 2026-09-15 — A is a host prerequisite, not a report defect: no `navigator.locks` in `packages/rifty/src/sandbox.ts` or `packages/workbench/src/workers/no-coi-toolchain-worker.ts`; resolved by guide composition, no new option.
- 2026-09-15 — B resolved by design: `probeBaseUrl` required, `TypeError` on omission; the omission path can never reach `supported`, matches existing option validation, removes the permanent misconfig cause from `inconclusive`. Overturns ADR-0437 decision 2 sentence "Omission reports incomplete asset-dependent checks" → DEC-2 at PICKUP (row 5) with its own decision subagent; the premise critic record is evidence, not that check.
- 2026-09-15 — C: module-SW probe stays (`register.ts:40`, `sandbox.ts:677`); no SW opt-out; id-based rows let `skipServiceWorker` hosts ignore them.
- 2026-09-15 — D: `modes.X` already is the summary; missing piece is id addressability → `reasons` renamed `unmet`, both lists become `SandboxSupportCheckId[]` (minimal interface, look up in `checks`); names pinned here and in row 2.
- 2026-09-15 — packaging: rides PR #340 before merge (PR-2; API unpublished, shape change is free now); PR returns to draft until this unit lands.
- 2026-09-15 — Safari/Firefox out of mission; `wasm` and `inconclusive` guidance are docs rows (3), no product change.
- 2026-09-15 — fault matrix: inherits the delivered unit's F1-F5 (`f63da13f9^` item); this unit adds no fault axis (omission branch removed, list retype).
- 2026-09-15 — final-check: 6 transcription problems, fixed in place (record: `reference/workbench-sandbox-support-consumer-challenge.md` §Final check); reviewer: fresh read-only subagent @ `f63da13f9` + drafts.
