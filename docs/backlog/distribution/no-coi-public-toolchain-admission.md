---
area: distribution
status: ready
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

Pickup source evidence at `69157c937`:

- `sandbox.ts:207-215` validates toolchain mode with literal equality but uses
  truthiness for generic admission. Real Node/Chromium REDs show `0`, `''` and
  `NaN` boot generic VFS/SW/Worker side effects; representative falsey/truthy
  non-booleans otherwise return the COI error instead of rejecting the invalid
  runtime type.
- `host.ts:185-192,302-372` terminates on an invalid handshake, but its retained
  message listener still accepts later `ready`/`result` frames: eight invalid
  protocol shapes each end at `isReady()===true` and emit three events instead
  of remaining terminal at one event.
- `sandbox.ts:217-238` already projects `runtime.fs`, `runtime.toolchain` and
  the handshake backend from one controller. Unit `opfs|memory` twins and the
  real headerless Chromium carrier are GREEN preservation evidence: page
  backend `memory`, Worker/public backend `opfs`, one native Worker.

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
- ADR-0375 Decision 1 carries the nested Worker URL, one Worker/VFS/runtime,
  exact handshake and immutable report from the superseded control-plane ADR.
- `SANDBOX_TOOLCHAIN_PROTOCOL` is the only admitted protocol value. The
  `toolchain-ready` frame's exact `opfs|memory` value is the public
  `vfs.backend`; the page probe is not an alternate source.
- Final review at `c2b13d0f3` observed the four proof gaps above. Existing v0
  mismatch and successful SDK carriers are preservation evidence, not closure.

## Acceptance

1. On a page where `crossOriginIsolated===false`, only the literal boolean
   `requireCrossOriginIsolation:false` admits either generic or toolchain
   no-COI boot. Generic omitted/true admission keeps `COI_REQUIRED_MESSAGE`;
   toolchain omitted/true retains its literal-false `TypeError`. Runtime values
   `0`, `''`, `NaN`, `null` and every other non-boolean reject `TypeError`
   before any Worker, VFS or Service Worker side effect.
2. Toolchain admission constructs exactly one Worker from the nested
   `toolchain.workerUrl`. The returned `runtime`, `fs` and `toolchain` send to
   that Worker and share its one VFS/runtime realm; no generic sibling Worker,
   page VFS or second controller is created.
3. Boot resolves only after both runtime readiness and one exact
   `toolchain-ready` frame carrying `SANDBOX_TOOLCHAIN_PROTOCOL` and
   `vfsBackend:'opfs'|'memory'`. A valid backend paired with any other protocol
   string/value/shape rejects
   `NotImplementedError('sandbox.toolchain.worker')`, terminates the Worker and
   ignores every later ready/result frame without changing readiness or
   emitting an event; it never resurrects or hangs.
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
   no-COI readiness. Artifact (Node 24.16.0, Vitest 2.1.9):
   `pnpm exec vitest run --project unit packages/rifty/src/sandbox.test.ts
   packages/runtime-js/src/host.test.ts -t "non-boolean no-COI|arbitrary
   protocol shapes|projects either admitted Worker backend" --reporter=dot`
   → 2 failed / 1 passed: generic `0|''|NaN` performed VFS+SW+Worker; the other
   representative non-booleans returned `Error`. Real public-SDK artifact
   (Playwright 1.60.0, Chrome
   148.0.7778.96): `pnpm test:no-coi -g "public SDK admits no-COI only through
   literal false|public SDK projects one real Worker, VFS and runtime authority"
   --reporter=line` → admission RED, authority GREEN, 1 failed / 1 passed.
2. Handshake matrix: exact protocol/backend vs several non-v0 mismatches,
   wrong value types and extra/missing/accessor fields. Every mismatch has one
   termination and zero later admission. Artifact: the Node command in row 1
   feeds eight prior/later/numeric/null/object/missing/extra/accessor protocol
   shapes; all reject the named gap, then wrongly accept later frames
   (`events 1→3`, `isReady false→true`) — the second expected RED.
3. Authority projection: instrumented public boot proves one Worker creation,
   one runtime/VFS realm and opposite page/Worker backend values; public
   `vfs.backend` follows the Worker. Artifact (Node 24.16.0, Vitest 2.1.9):
   `pnpm exec vitest run --project unit packages/rifty/src/sandbox.test.ts
   packages/runtime-js/src/host.test.ts -t "projects either admitted Worker
   backend|admits only the exact protocol/backend frame|valid backend but
   mismatched protocol" --reporter=dot` → 3/3 passed. The real Chromium command
   in row 1 proves one native module Worker, page `memory`, Worker/public `opfs`
   and exact `fs`/`toolchain` controller identity.
4. Report/realm sibling: exact immutable report plus the already-landed real
   same-realm warnings, stdio, CPU and execSync outcomes in headerless Chrome.
   Artifact (Playwright 1.60.0, Chrome 148.0.7778.96): `pnpm test:no-coi -g
   "capability and no-COI degradation contract|public SDK projects one real
   Worker, VFS and runtime authority" --reporter=line` → 2/2 passed in 7.8s.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `false-fallback` × no-COI admission | literal false only; defaults stay loud and falsey non-booleans reject before boot | Acceptance/Parity 1/1; Node+Chromium RED commands and exact side-effect counts in Parity 1 |
| `corrupt-input` + `provenance-lie` × Worker handshake | only exact protocol/backend admits; mismatch terminates and later frames cannot revive it | Acceptance/Parity 3/2; eight-shape Node RED command/output/version in Parity 2 |
| `provenance-lie` + `sibling-drift` × public authority projection | one Worker owns runtime/fs/toolchain/VFS; backend comes from its admitted frame | Acceptance/Parity 2,4/3; Node `opfs|memory` twins + real opposite-backend Chromium command/output/version in Parity 3 |
| `lossy-aggregate` × capability report | exact recursively frozen ordered rows agree with real landed behavior | Acceptance/Parity 5/4; real headerless Chromium report/realm command/output/version in Parity 4 |

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
- PICKUP expected RED band is 3–3 tests: Node admission, Node handshake
  quarantine and real headerless Chromium admission. Worker backend/one-realm
  twins and real capability/authority carriers are GREEN preservation controls.
- No user-observable fork remains. Error class for runtime non-booleans follows
  the existing toolchain `TypeError`; omitted/true behavior is unchanged. No
  production implementation, sibling lifecycle/package/build/host behavior or
  Vite fixture entered this boundary.
