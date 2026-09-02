---
area: distribution
status: draft
title: no-COI public toolchain admission and one-Worker projection
created: 2026-09-02
epic: no-coi-sandbox-tier
why: the public SDK path already boots a toolchain Worker, but Final review did not prove literal-false-only no-COI admission, arbitrary protocol mismatch rejection, authoritative Worker VFS projection, or exactly one Worker/VFS/runtime authority
user_story: As an existing non-COI app, I want one explicit SDK admission to return one sandbox whose runtime, fs, toolchain and capability report describe the same Worker authority, while defaults and malformed admissions fail before an unusable sandbox escapes
sources: [ADR-0375, docs/process/fault-classes.md, distribution/no-coi-sandbox-build-loop]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts, packages/runtime-js/src/protocol.ts, packages/rifty/src/sandbox.test.ts, packages/runtime-js/src/host.test.ts, tests/no-coi/no-coi-sandbox-build-loop.spec.ts]
---

## Context

Split successor of `distribution/no-coi-sandbox-build-loop` at binding Final
stop `e5347179f`. The predecessor retains the complete pre-demotion Acceptance,
Parity and checkpoint lineage. This child owns frozen goal I1 only: public
admission, capability projection and one Worker/VFS/runtime authority. Landed
I7 behavior is observed through the report and real realm, not reopened.

It owns four current HOLDS: any-protocol mismatch plus later-frame
non-admission; public `vfs.backend` projection; exactly one Worker/VFS/runtime;
and literal-`false`-only admission. Upstream: none. Downstream:
`distribution/no-coi-toolchain-operation-lifecycle`,
`distribution/no-coi-sandbox-package-install`,
`distribution/no-coi-sandbox-build-loop`,
`distribution/no-coi-host-posture-preservation` and
`distribution/no-coi-dev-hmr-restore`.

The authority is package-generic. No Vite identity, version, path, callback,
type or lifecycle participates; Vite fixtures are absent from this contract.

## Challenge

challenge: 2026-09-02 — clear

## User scenario

On a real headerless Chromium page, an app imports the public SDK and calls
`createSandbox({requireCrossOriginIsolation:false,
toolchain:{workerUrl}})`. The promise resolves only after one exact Worker
handshake. The returned `runtime`, `fs`, `toolchain`, `vfs` and immutable
capability report all project that same Worker. Default or malformed admission
never returns a partially live sandbox.

## Reference contract

- Goal I1 requires a real no-COI public boot plus working/degraded/throwing
  capability projection. I8 supplies the eventual cross-goal lane, not a
  second product authority.
- ADR-0375 Decisions 1 and 5 fix the nested Worker URL, one
  Worker/VFS/runtime, exact handshake and immutable report.
- `SANDBOX_TOOLCHAIN_PROTOCOL` is the only admitted protocol value. The
  `toolchain-ready` frame's exact `opfs|memory` value is the public
  `vfs.backend`; the page probe is not an alternate source.
- Final review at `c2b13d0f3` observed the four proof gaps above. Existing v0
  mismatch and successful SDK carriers are preservation evidence, not closure.

## Acceptance

1. On a page where `crossOriginIsolated===false`, only the literal boolean
   `requireCrossOriginIsolation:false` admits either generic or toolchain
   no-COI boot. Omitted/true admission keeps `COI_REQUIRED_MESSAGE`; runtime
   values `0`, `''`, `NaN`, `null` and other non-booleans reject before any
   Worker, VFS or Service Worker side effect.
2. Toolchain admission constructs exactly one Worker from the nested
   `toolchain.workerUrl`. The returned `runtime`, `fs` and `toolchain` send to
   that Worker and share its one VFS/runtime realm; no generic sibling Worker,
   page VFS or second controller is created.
3. Boot resolves only after both runtime readiness and one exact
   `toolchain-ready` frame carrying `SANDBOX_TOOLCHAIN_PROTOCOL` and
   `vfsBackend:'opfs'|'memory'`. A valid backend paired with any other protocol
   string/value/shape rejects
   `NotImplementedError('sandbox.toolchain.worker')`, terminates the Worker and
   ignores every later ready/result frame; it never resurrects or hangs.
4. Public `sandbox.vfs.backend` equals the admitted Worker's exact backend.
   Tests distinguish Worker `opfs` and `memory` from the opposite page-realm
   probe so a page-derived or hard-coded projection fails.
5. The recursively frozen report has schema 1, tier `shared-memory-free`, exact
   row order and the frozen working/degraded/throwing outcomes. The real realm
   agrees on landed I7 behavior: same-realm spawn/Worker warn once, child stdio
   remains piped, CPU surfaces report one, and execSync throws its named gap.
   `toolchain.dev-hmr` remains throwing until its blocked child certifies.
6. The public no-COI proof runs in the committed headerless Chromium lane.
   That lane is evidence only: no SDK/runtime/control/package/distribution
   authority imports or branches on a proof fixture's identity or lifecycle.

## Parity cases

1. Admission matrix: omitted/true vs literal false vs runtime falsey
   non-booleans, with exact boot-side-effect counts. Only literal false reaches
   no-COI readiness.
2. Handshake matrix: exact protocol/backend vs several non-v0 mismatches,
   wrong value types and extra/missing/accessor fields. Every mismatch has one
   termination and zero later admission.
3. Authority projection: instrumented public boot proves one Worker creation,
   one runtime/VFS realm and opposite page/Worker backend values; public
   `vfs.backend` follows the Worker.
4. Report/realm sibling: exact immutable report plus the already-landed real
   same-realm warnings, stdio, CPU and execSync outcomes in headerless Chrome.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `false-fallback` × no-COI admission | literal false only; defaults stay loud and falsey non-booleans reject before boot | Acceptance/Parity 1/1; side-effect counters |
| `corrupt-input` + `provenance-lie` × Worker handshake | only exact protocol/backend admits; mismatch terminates and later frames cannot revive it | Acceptance/Parity 3/2; arbitrary mismatch matrix |
| `provenance-lie` + `sibling-drift` × public authority projection | one Worker owns runtime/fs/toolchain/VFS; backend comes from its admitted frame | Acceptance/Parity 2,4/3; opposite-backend sentinel |
| `lossy-aggregate` × capability report | exact recursively frozen ordered rows agree with real landed behavior | Acceptance/Parity 5/4; report + realm carrier |

## Out of scope

- No package installation result, installed-bin execution, busy/settlement
  lifecycle, build bytes or host-posture duration; downstream children own
  those contracts.
- No Vite/Rolldown identity, version, path, callback, type, lifecycle or test
  setup. They cannot become public or infrastructure authority.
- No new SDK option, protocol version, Worker topology or VFS backend.
- No dev/HMR, restart, death event or pending-write marker.
- No heartbeat, journal, automatic reconnect/retry, exactly-once recovery,
  hidden retry, queue, crash durability or other robust-tier mechanism.

## Decisions

review: checkpoints — public SDK/Worker trust boundary and real Chromium I1
projection.

predecessor: `distribution/no-coi-sandbox-build-loop`

- Owns Final HOLDS: arbitrary protocol mismatch, public Worker VFS projection,
  one Worker/VFS/runtime and literal-false-only admission.
- Dependency direction: this child has no new child dependency; every open
  build prerequisite and dev-HMR links back to it.
- `contract-red: 2026-09-01 — blocker @ 326f5b70e`
- `ready-verdict: 2026-09-01 — Contract+RED @ f0066d4d2`
- `final-green: 2026-09-01 — blocker @ 07d370651`
- `final-green: 2026-09-01 — blocker @ bcff49986`
- `final-green: 2026-09-01 — blocker @ 541c4cd6c`
- `contract-red: 2026-09-01 — blocker @ 2f1063608`
- `ready-verdict: 2026-09-01 — Contract+RED @ ead27000f`
- `final-green: 2026-09-01 — blocker @ a909a38a9`
- `final-green: 2026-09-01 — blocker @ 6f86d2e7f`
- Bounded-cause split successor certified Final+GREEN at `40ded4758`.
- `ready-verdict: 2026-09-01 — Contract+RED @ df3cc811d`
- `final-green: 2026-09-02 — blocker @ 01465c6ae`
- Descriptor split successor certified Final+GREEN at `dce86792d`.
- `contract-red: 2026-09-02 — blocker @ 41d63c086`
- `ready-verdict: 2026-09-02 — Contract+RED @ 15dbca164`
- `final-green: 2026-09-02 — blocker @ c2b13d0f3`
- Count lineage: `07d370651`/`bcff49986`/`541c4cd6c` counts are unavailable;
  counted Final rounds are `1@a909a38a9 → 1@6f86d2e7f` (stop, bounded child
  PASS), `1@01465c6ae` (carried stop, descriptor child PASS), then
  `15@c2b13d0f3`; latest `1→15` fired convergence. Contract continuation was
  `1@41d63c086 → PASS@15dbca164`.
- Binding stop is recorded at `e5347179f`. Its PR-body band HOLD was already
  fixed in draft PR 294 and is excluded from this child's four current HOLDS.
