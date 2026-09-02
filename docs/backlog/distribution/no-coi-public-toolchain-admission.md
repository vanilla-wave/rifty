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
- `host.ts:185-192,302-372,503-524` terminates on an invalid handshake and its
  exact decoder rejects clone-preserved corrupt shapes. Chrome proves a sender
  accessor returning the exact protocol arrives as an ordinary exact data
  property, so admitting it is correct. A real Worker that queues v2, then v1,
  then result frames still yields one public rejection and one termination.
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
   clone-preserved string/value/shape rejects
   `NotImplementedError('sandbox.toolchain.worker')`, terminates the Worker and
   remains rejected if that Worker already queued later exact ready/result
   frames; no sandbox escapes and nothing hangs. A sender accessor that returns
   the exact protocol is not a mismatch: Worker structured clone materializes
   it as the exact ordinary data property the receiver admits.
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

1. Admission matrix: omitted/true vs literal false vs runtime
   non-booleans, with exact boot-side-effect counts. Only literal false reaches
   no-COI readiness. Artifact (Node 24.16.0, Vitest 2.1.9):
   `pnpm exec vitest run --project unit packages/rifty/src/sandbox.test.ts
   packages/runtime-js/src/host.test.ts -t "COI is required but absent|boots
   without COI when requireCrossOriginIsolation is false|rejects toolchain
   admission unless|rejects every non-boolean no-COI|projects either admitted
   Worker backend|clone-preserved arbitrary protocol shapes|admits only the
   exact protocol/backend frame" --reporter=dot` → 1 failed / 8 passed:
   omitted/true/literal-false twins all execute; generic `0|''|NaN` performs
   VFS+SW+Worker and other representative non-booleans return `Error`.
   Real public-SDK artifact (Playwright 1.60.0, Chrome 148.0.7778.96):
   `pnpm test:no-coi -g "public SDK admits no-COI only through literal
   false|capability and no-COI degradation contract|public SDK projects one
   real Worker, VFS and runtime authority|Chrome Worker clone
   materializes|public SDK rejects an invalid real Worker" --reporter=line`
   → admission RED plus four GREEN controls, 1 failed / 4 passed in 9.8s.
2. Handshake matrix: exact protocol/backend vs several non-v0 mismatches,
   wrong clone-preserved value types and extra/missing fields. Every mismatch
   has one termination and zero later admission. Artifact: the Node command in
   row 1 feeds eight prior/later/numeric/null/object/missing/extra/boolean
   protocol shapes; all reject and settle pending work, GREEN. The Chromium
   command proves both platform facts: an exact accessor becomes an admitted
   exact data property; a real Worker queuing mismatched then exact ready/result
   frames still rejects publicly with one construction and one termination.
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
| `corrupt-input` + `provenance-lie` × Worker handshake | only exact clone result admits; mismatch terminates and queued later frames cannot reverse public rejection | Acceptance/Parity 3/2; eight-shape Node matrix + real Chrome accessor/queued-frame command/output/version in Parity 2 |
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

ready-verdict: 2026-09-02 — Contract+RED @ b40ad7c37

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
- `contract-red: 2026-09-02 — blocker @ 2ba023fff`
- Contract+RED reviewed tree
  `cda178d66bb8d651b860fefad4d96f19506185f4` against certified BASE
  `dce86792d` / tree `b1e0244ad`: find 3 blockers / 3 concerns / 0 nits,
  coverage 10 pass / 6 weak / 0 missing of 16; fresh tail 0 / 0 / 0,
  coverage 16/16; adjudication 3 HOLDS / 0 STRETCH / 0 FALSE;
  `blockers.mjs` exit 1.
- HOLDS: Parity 1's command omits its claimed omitted/true cases; an accessor
  protocol structured-clones into an exact admitted data property; frames
  injected through `FakeWorker` after `terminate()` are physically excluded by
  a real Worker and cannot prove the declared late-frame behavior.
- Current-unit Contract blocker counts are `[3]`; no consecutive Contract
  blocker, Contract-escalation or convergence valve. No fix, re-cut,
  implementation or next review round started.
- One in-place Contract blocker batch addresses all three review defects without
  product code: Parity 1 now selects omitted/true/literal-false/non-boolean
  siblings; the protocol matrix contains only clone-preserved corrupt values;
  real Chrome pins accessor materialization and queued-frame non-admission.
- Active expected RED band is 2–2 (Node + real-Chromium admission twins). The
  original 3–3 row remains append-only history; its third FakeWorker
  post-terminate RED was physically impossible and is removed, not converted
  into an implementation demand. Current Contract counts remain `[3]`; review
  verification is pending and no next checkpoint was run.
- Contract+RED VERIFY reviewed `b40ad7c37f975a9c2d447e4d64b5abbad60db0f6`,
  tree `0490e0379`, against BASE `dce86792d` / tree `b1e0244ad`: find 0
  blockers / 1 concern / 0 nits, coverage 16/16; fresh tail 0 / 0 / 0,
  coverage 16/16; independent adjudication `[]`; `blockers.mjs` exit 0. Prior
  three HOLDS closed; current Contract lineage `[3]→PASS`, no valve.
- `final-green: 2026-09-02 — blocker @ 5990557b2`
- Final+GREEN reviewed `5990557b282965ff878b33bb4ddf4f839c2b9c50`, tree
  `fb3aca6fdd4ea664a8f8259ec7a40a69b56cf110`, against BASE `dce86792d` /
  tree `b1e0244ad`: external `pr:check` 24/24, Node 9/9, focused Chrome
  5/5 and full no-COI 20/20. FIND union 4 candidates / 2 concerns, raw
  coverage 9 pass / 7 weak / 0 missing; original tail hung and was interrupted,
  so it is excluded. Replacement fresh tail is empty with coverage 16/16.
  Adjudication: 3 HOLDS / 1 STRETCH / 0 FALSE; calibrated `blockers.mjs` exit 1,
  3 blockers / 3 concerns / 0 nits.
- HOLDS: universal non-boolean coverage includes explicit-own `undefined` plus
  a category mutant; rejection pins the exact complete VFS/SW/Worker
  side-effect vector; both-signal readiness pins reverse arrival order.
  `workerUrl` and two undeclared frame-policy demands are STRETCH/concerns only.
- Current-unit Final counts are `[3]`; inherited latest `15→3` strictly falls,
  so no convergence valve. No blocker batch, product/test fix, next Final round
  or RECHART started.
- Post-Final expected RED band is 2–2: one Node and one real headerless
  Chromium universal-admission test fail only for explicit-own `undefined` in
  generic+toolchain paths. Current tree: Node 1 failed / 8 passed; Chrome
  1 failed / 4 passed. Bigint/symbol/function/category, exact effect-vector and
  reverse exact/mismatch readiness controls are GREEN. Original 3–3 and active
  2–2 pickup bands remain append-only history.
- Post-Final batch GREEN: omitted remains default while own `undefined` and all
  non-boolean categories reject before the exact zero-effect vector. Node 9/9,
  focused Chrome 5/5, full no-COI 21/21; incomplete category whitelist,
  pre-guard duplicate VFS and removed-readiness-gate mutants restore the exact
  REDs, then source hashes restore exactly. SDK/runtime-js typechecks and arch
  pass; outside-sandbox `pr:check` 24/24 (`test:run` 193.2s, parity 69.2s).
  Unit/goal/outside-goal residuals empty; Final verification pending.
- `final-green: 2026-09-02 — blocker @ 6da3ccd35`
- Final+GREEN VERIFY reviewed `6da3ccd358d6e5ad8f3208289286b77b9411c498`,
  tree `1410b38e1969c6a617e7847219baba8b32d31d6a`: external `pr:check`
  24/24, Node 9/9 and Chrome 5/5; coverage 16/16. Prior three HOLDS closed;
  fresh tail found one goal-drift candidate, adjudicated 1 HOLDS;
  `blockers.mjs` exit 1 with 1 blocker / 0 new concerns / 0 nits.
- HOLD: current Decisions and ledger claim unit/goal/outside-goal residuals are
  all empty while the map still carries five downstream goal children. AGENTS
  DoD requires unit and goal status separately; the false statement remains
  unchanged until the blocker batch.
- Current-unit Final counts are `3→1`, strictly falling; no convergence valve.
  No bookkeeping fix, next Final round or RECHART started.
- Residual correction supersedes the earlier false
  `Unit/goal/outside-goal residuals empty` claim without rewriting it: current
  admission unit residuals 0 after behavior proof; goal residuals 5 —
  `distribution/no-coi-toolchain-operation-lifecycle`,
  `distribution/no-coi-sandbox-package-install`,
  `distribution/no-coi-sandbox-build-loop`,
  `distribution/no-coi-host-posture-preservation` and
  `distribution/no-coi-dev-hmr-restore` (including final I8); outside-goal
  residuals 0. Authority: `docs/backlog/epics/no-coi-sandbox-tier/map.md` and
  AGENTS.md DoD's required separate slice/goal status.
- `final-green: 2026-09-02 — blocker @ e38fd5aa7`
- Final+GREEN reviewed `e38fd5aa7a2e670c2c2919a0256eecc92e8f0050`, tree
  `978d8599053b770adf3b2f2e512c9246428789a1`, against BASE `dce86792d` /
  `b1e0244ad`: fresh FIND 3 candidates, coverage 9 pass / 7 weak; fresh tail
  0 / 0 / 0, coverage 16/16; adjudication 2 HOLDS / 1 STRETCH / 0 FALSE;
  calibrated `blockers.mjs` exit 1, 2 blockers / 1 concern / 0 nits. Full
  `pr:check` 24/24.
- HOLDS: invalid generic/toolchain admission proves canonical `TypeError`
  identity in Node and public Chromium; protocol/backend failure proves
  canonical `NotImplementedError` identity in Node and public Chromium.
  Exhaustive missing-`vfsBackend`/coercion siblings remain STRETCH concern,
  not scope.
- Exact Final counts are `3@5990557b2 → 1@6da3ccd35 → 2@e38fd5aa7`.
  Raw FIND merge text incorrectly claimed convergence at unadjudicated 3.
  Calibrated rule needs two consecutive non-decreases: `3→1` decreases, then
  `1→2` increases, so no valve now. Next round `X≥2` would fire on `1→2→X`.
  No blocker batch, product/test fix or next Final round started.
- Post-identity expected RED band is 0–0 new REDs: current product already
  returns realm-canonical classes. Node canonical generic/toolchain TypeError
  plus protocol/backend NotImplementedError siblings pass 6/6; real headerless
  Chromium through public SDK + `@riftydev/sdk/io` passes 3/3. Product stays
  unchanged; forged-class mutant proof follows in this batch. All prior bands
  and Final lineage carry.
- Post-identity batch GREEN with no product change: Node canonical matrix 6/6,
  focused public Chromium 3/3, full no-COI 22/22. Forged ordinary
  `Error{name:'TypeError'}` fails the generic+toolchain Node carrier 1/1 and
  Chromium carrier 1/1; forged ordinary
  `Error{name:'NotImplementedError',feature:'sandbox.toolchain.worker'}` fails
  Node protocol/backend siblings 5/5 and public Chromium protocol/backend 2/2.
  Product hashes restore exactly (`sandbox.ts`
  `a135270540919a31acf8d23763018591bf8cfc6c61b3728a9798da363162fb7a`,
  `host.ts` `02c16d1e6724cad072c58c946b4519bb70c79b375747b1eecc48b3e231830ae1`).
  SDK/runtime-js typechecks, arch and outside-sandbox `pr:check` 24/24 pass
  (`test:run` 202.1s, parity 69.9s). Residual classification remains unit 0,
  goal 5 per map, outside-goal 0; Final verification pending.
- `final-green: 2026-09-02 — blocker @ 3006ca1f1`
- Final+GREEN reviewed `3006ca1f139b757117e0f7504ac4aa60e2c674fa`, tree
  `18de6be3998c66f66f4e7785306b701ae9c3a65c`, against BASE `dce86792d` /
  `b1e0244ad`. The sandbox gate was invalid only from TSX IPC and loopback
  `listen EPERM`; the required outside-sandbox rerun passed 24/24
  (`test:run` 185.2s, parity 84.8s).
- Fresh FIND: 4 raw blocker findings / 2 concerns / 0 nits, including one
  process-valve finding; coverage 9 pass / 7 weak / 0 missing of 16 and three
  behavioral unit residuals. Fresh tail: 0 new findings, coverage 16/16, unit
  residuals 0 and the same five goal residuals. Independent adjudication:
  4 HOLDS / 0 STRETCH / 0 FALSE; `blockers.mjs` exit 1 with 4 blockers /
  2 concerns / 0 nits. The valve finding is not counted as its own behavioral
  defect, so exact calibrated current count is `X=3`.
- HOLDS: exact-protocol proof does not kill a `startsWith` decoder admitting
  `rifty.sandbox-toolchain/v10` through Node and the public real Worker across
  backend/readiness siblings; toolchain omitted/true proof admits an ordinary
  `Error{name:'TypeError'}` instead of canonical `TypeError` in Node and public
  Chromium; generic omitted/true proof admits prefixed/suffixed
  `COI_REQUIRED_MESSAGE` instead of exact equality in Node and public Chromium.
  Singleton-array coercion and exact extra report-key closure remain concerns,
  not additional HOLDS; no sibling lifecycle/package/build/host/HMR demand
  entered this unit.
- Exact Final lineage is
  `3@5990557b2 → 1@6da3ccd35 → 2@e38fd5aa7 → 3@3006ca1f1`.
  The latest `1→2→3` has two consecutive non-decreases, so the Final
  convergence valve fires. Current residuals: admission unit 3; goal 5
  (lifecycle, package-install, build-loop, host-posture, dev-HMR/final I8);
  outside-goal 0. No fix batch, another review, RECHART or next unit may start.
- User override 2026-09-02 resolves the binding stop at `c33b3aa27`: resume
  this unit only for one proof-only batch covering the three recorded HOLDS,
  keep product bytes unchanged unless an executed RED proves otherwise, exclude
  both recorded concerns and every sibling slice, then require a fresh
  Final+GREEN before RECHART. No remaining goal slice is authorized here.
- Override batch is proof-only and closes exactly the three HOLDS. Node pins
  v10-prefix rejection for both backends before runtime readiness, canonical
  omitted/true toolchain `TypeError` and exact generic `COI_REQUIRED_MESSAGE`;
  public headerless Chromium pins the same through the real SDK/Worker realm.
- Discriminating mutants RED: a `startsWith` protocol decoder fails Node 2/2
  and public Chromium 2/2; ordinary `Error{name:'TypeError'}` fails Node 2/2
  and Chromium 1/1; prefixed `COI_REQUIRED_MESSAGE` fails Node 2/2 and
  Chromium 1/1. Restored sources match exact SHA-256 `sandbox.ts`
  `a135270540919a31acf8d23763018591bf8cfc6c61b3728a9798da363162fb7a`
  and `host.ts`
  `02c16d1e6724cad072c58c946b4519bb70c79b375747b1eecc48b3e231830ae1`.
- Batch GREEN: focused Node 7/7; focused public Chromium 4/4 in 8.6s; full
  no-COI 22/22 in 2.0m; SDK/runtime-js typechecks, lint and arch pass. Unit
  residuals 0; goal residuals 5 per map; outside-goal residuals 0. Full
  `pr:check` and fresh Final+GREEN pending; concerns and sibling scope unchanged.
- `final-green: 2026-09-02 — blocker @ 46b4679b0`
- Final+GREEN reviewed `46b4679b049311b60abe65e9a3f447d2847198b2`, tree
  `c8082fab7ed7fc3d7914a685e69bd64627fd677e`, against BASE `dce86792d` /
  `b1e0244ad`: `pr:check` 24/24 (`test:run` 240.1s, parity 75.2s),
  focused Node 7/7, Chromium 4/4 and full no-COI 22/22.
- Fresh FIND had one behavioral candidate plus one PR-body concern, coverage
  12 pass / 4 weak / 0 missing of 16; fresh tail 0 new findings, coverage
  16/16. Independent adjudication: 1 HOLDS / 0 STRETCH / 0 FALSE;
  `blockers.mjs` exit 1 with 1 blocker / 1 concern / 0 nits.
- HOLD: the public Chromium exact-message carrier exercises generic omission
  but not generic explicit `true`, so a browser-only true-branch suffix can
  pass while violating the already-recorded omitted/true HOLD. Current
  residuals: unit 1 / goal 5 / outside 0. This is the first post-override Final
  blocker round; one same-HOLD proof correction is pending, no new scope.
- Same-HOLD correction adds public generic omitted/true twins with exact
  exported `COI_REQUIRED_MESSAGE`, zero Worker construction and only capability
  detection before rejection. A browser-only explicit-true suffix mutant keeps
  Node 2/2 GREEN but fails public Chromium 1/1; restored Chromium carrier passes
  1/1 in 6.6s and `sandbox.ts` returns to SHA-256
  `a135270540919a31acf8d23763018591bf8cfc6c61b3728a9798da363162fb7a`.
  Unit residuals return to 0; goal 5 / outside 0; full no-COI, `pr:check` and
  Final verification pending. No other concern or sibling changed.
- `final-green: 2026-09-02 — PASS @ 182f01b4c`
- Final+GREEN VERIFY reviewed `182f01b4cea906ceb34a90f9be8d090e5efa28a7`,
  tree `a7d28416b284c7f251af085e8da094659706d7da`, against BASE `dce86792d` /
  `b1e0244ad`: fresh FIND 0 blockers / 1 post-PASS PR-body concern / 0 nits,
  coverage 16/16; fresh tail 0 / 0 / 0, coverage 16/16; independent
  adjudication `[]`; `blockers.mjs` exit 0. Unit residuals 0; goal residuals 5;
  outside-goal residuals 0; `goal_complete:false`.
- Final tree proof: full no-COI 22/22 in 2.2m; full outside-sandbox
  `pr:check` 24/24 (`test:run` 225.1s, parity 77.4s). Product hashes remain
  exact. The sole concern requires the user-ordered post-PASS PR head/body sync,
  not another unit change. Admission is landed and ready for one RECHART.
