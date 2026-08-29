---
area: runtime-js
status: ready
title: worker-realm-compat TextDecoder shim throws ReferenceError in realms without SharedArrayBuffer
created: 2026-08-26
why: without COI Chromium defines NO `SharedArrayBuffer` global binding; the shim's bare references make EVERY decode() in that realm throw ReferenceError — yet shared `WebAssembly.Memory` views EXIST there and Node decodes them, so the patch is needed, realm-safe
user_story: As a dev on the no-COI fallback tier, I want TextDecoder to keep working, but today `installSharedMemoryTolerantTextDecoder`'s patched decode references bare `SharedArrayBuffer` and throws `ReferenceError` on every call in a realm where the binding is absent.
epic: no-coi-sandbox-tier
sources: [docs/backlog/runtime-js/reference/no-coi-degradation-probes.md, docs/backlog/runtime-js/reference/no-coi-realm-probe-transcript-2026-08-29.json, tools/probes/no-coi-realm-probe.mjs]
code: [packages/runtime-js/src/ipc/worker-realm-compat.ts, packages/runtime-js/src/ipc/install-process.ts]
---

## Context

Two verified halves — real no-COI Chromium 148.0.7778.96 probe (page AND
dedicated Worker; command + output + version:
`reference/no-coi-degradation-probes.md` §2026-08-29, "probe row N" below) +
Node v24.16.0 oracle:

1. `installSharedMemoryTolerantTextDecoder` patches `TextDecoder.prototype.decode`
   with bare `SharedArrayBuffer` references (worker-realm-compat.ts:75,80).
   Install carrier — narrower than previously claimed (checkpoint-2 G1
   correction): `installNodeRuntime` (install-process.ts:117) runs it ONLY as
   the kernel pre-entry hook in kernel-spawned Node workers; the PUBLIC
   `@riftydev/runtime-js/worker` entry (worker-entry.ts — what
   `createSandbox`→`spawnRuntime` boots) installs NEITHER it NOR
   `installWorkerRealmCompat`, so today's SDK no-COI path never installs the
   shim organically. Whether the tier's composition CAN install the Node
   runtime in its realm — making this I2-load-bearing organically — is
   UNSETTLED: map Open question "installNodeRuntime seam" (checkpoint-3;
   settlement re-assigned checkpoint-4 B6 — a deliverable of the first slice
   composing the no-COI runtime, certified at ITS Contract+RED, never a slicing
   gate); a NO re-fits the I2 mapping. The defect itself is helper-level and
   certain: no-COI Chromium has no `SharedArrayBuffer` binding (probe row 1) →
   wherever the shim installs in such a realm EVERY `decode()` throws
   `ReferenceError: SharedArrayBuffer is not defined` — bytes, no-arg, shared
   inputs alike (probe row 8, both realms) — including the host's own
   loader/infra decodes (reference doc §Blast-radius).
2. Absent binding ≠ no shared input: `new WebAssembly.Memory({shared:true})`
   constructs no-COI and its `buffer` IS a SharedArrayBuffer (brand-verified,
   probe row 2); native decode rejects its views (`TypeError: … must not be
   shared`, probe row 3) where Node v24.16.0 decodes. So the spike-era "no-op
   install" guard was WRONG (frozen assumption killed by row 2): the patch is
   NEEDED in SAB-less realms; the fix is realm-safe shared detection inside the
   patched body — never a bare binding reference, never a skipped install.
   ADR-0162 decision 3 ("patched UNCONDITIONALLY") stands.

Node-sim repro from real source (secondary — real-realm evidence is the probe;
node v24.16.0, worktree 2026-08-29):

```
npx esbuild packages/runtime-js/src/ipc/worker-realm-compat.ts --format=esm --outfile=/tmp/wrc-spike.mjs
node --input-type=module -e 'delete globalThis.SharedArrayBuffer;
  const m = await import("/tmp/wrc-spike.mjs");
  class Dec { decode(i){ return i === undefined ? "" : "decoded"; } }
  console.log("install:", m.installSharedMemoryTolerantTextDecoder(Dec));
  new Dec().decode(new Uint8Array(3));'
# → install: true
# → ReferenceError: SharedArrayBuffer is not defined
# same with no-arg new Dec().decode()
```

## Reference contract

- Decode-behavior oracle: **Node v24.16.0 `TextDecoder`** (probe table Node
  column): shared-wasm view at nonzero offset → its bytes' text; raw shared
  buffer → whole-buffer text; multibyte split across shared views with
  `{stream:true}` on one decoder → exact char; non-shared and no-arg unchanged.
- Realm reference: **real no-COI Chromium 148.0.7778.96** (Playwright-pinned
  build); mechanism: page served over plain HTTP with NO COOP/COEP + a
  dedicated module Worker on it (probe §2026-08-29). Every substrate test
  asserts `crossOriginIsolated === false` AND
  `typeof SharedArrayBuffer === 'undefined'` before acting — a future Chromium
  change fails loud, never silently re-scopes the test.
- Approximation rejected: stubbing `SharedArrayBuffer = undefined` in a
  COI/Node realm is NOT this realm (`instanceof undefined` TypeError, not the
  absent-binding ReferenceError); the RED must run in the real no-COI browser
  realm with the real built shim.

## Acceptance

- RED-first on a real no-COI Chromium substrate — headerless page AND dedicated
  module Worker, exercising the real built shim (not a source copy), both
  asserting the Reference-contract preconditions before acting. COMMITTED at
  this Contract+RED (checkpoint-2 C1): `playwright.no-coi.config.ts` +
  `tests/no-coi/` (server without COOP/COEP, esbuild of the prod sources,
  probe body shared with the replayable evidence driver); run
  `pnpm test:no-coi` — today 8 RED (parity 1–7, every failure
  `ReferenceError: SharedArrayBuffer is not defined`; parity 12, every poisoned
  decode trips the counting accessor) + 2 green pins (preconditions,
  parity 10), inside the declared 5–8 band. Substrate = the goal's first no-COI
  test lane (ADR-0369), reusable by later slices; flips GREEN in the fix PR,
  never edited to pass.
- After install (direct or via `installWorkerRealmCompat()`) in that realm,
  decode NEVER evaluates the absent binding — every input class:
  `decode(encode('hello'))` → `'hello'`; `decode()` → `''`; shared-wasm
  Uint8Array view AND DataView ('hello' bytes at offset 3, len 5) → `'hello'`
  (a Uint8Array-only branch must not pass); raw shared-wasm buffer →
  Node-identical whole-buffer text pinned EXACTLY as length + SHA-256 of the
  text (projections — char counts, slices — collide on corrupted/repositioned
  sentinels and are out); `é` split across two shared-backed views with
  `{stream:true}` on ONE decoder → `'é'`. Today ALL throw
  `ReferenceError` (probe row 8). "NEVER evaluates" is itself pinned by an
  observable, not inferred from outputs (checkpoint-4 B3 — output rows alone
  admit a try/catch over the bare identifier): with `SharedArrayBuffer`
  defined as a counting, throwing accessor AFTER install, the full decode
  sweep (bytes / no-arg / shared view / DataView / raw buffer / streaming,
  direct AND aggregate installs) returns the same outputs with access count
  EXACTLY 0 (parity 12; today count 6 — every class trips the poison,
  probe row 13).
- `installSharedMemoryTolerantTextDecoder` returns `true` and marks the patched
  fn there too (unconditional patch retained — ADR-0162); repeat install
  (direct AND via aggregate) → `false` AND `proto.decode` strictly `===` the
  captured first patched function AND shared decode still green — booleans
  alone don't close this.
- Aggregate pins ALL sibling effects together, snapshot IMMEDIATELY after the
  FIRST `installWorkerRealmCompat()` call (an effect observable only after a
  second call fails): `global === globalThis`; `self` an OWN (`Object.hasOwn`)
  writable DATA property whose PRE-WRITE value is `globalThis` — only then the
  assignment (doesn't throw, value kept); decode green at call one; marker
  present — no guard at helper or aggregate level may skip a sibling
  installer, and a post-write compare alone (passes on `self=null` or an
  inherited setter) closes nothing.
- COI-realm exactness pins (unit, injected decoders): copy path respects
  byteOffset/byteLength against sentinel bytes; non-shared path passes the
  EXACT input and opts objects and propagates the exact thrown error object
  (Parity 8–9). COMMITTED (checkpoint-2 C2/C3): added describes in
  `worker-realm-compat.test.ts` — sentinel/nonzero-offset Uint8Array, DataView
  over shared buffer, raw-SharedArrayBuffer whole-buffer exactness, exact
  input/opts identity (view/DataView/ArrayBuffer/no-arg), sentinel-error
  identity (non-shared AND shared post-copy), repeat-install identity for
  direct AND aggregate sequences — all green pins guarding the fix.
  Checkpoint-3/4 additions (same file, still green): aggregate CALL-ONE
  sibling snapshot (global/self before any repeat) and a SEPARATE
  installWritableSelf strengthened-pin test (ownership/descriptor/pre-write
  value) — checkpoint 4 (B4) restored the pre-existing installWritableSelf
  test byte-identical to main; it is the unmodified-baseline carrier.
- COI behavior unchanged: every pre-existing test in
  `worker-realm-compat.test.ts` stays green and byte-identical to main (the
  branch diff of that file is additions only); strengthened pins are ADDED,
  never edited-to-pass.

## Parity cases

Oracles per Reference contract; every row's artifact is REPLAYABLE
(checkpoint-2 C4): `node tools/probes/no-coi-realm-probe.mjs` regenerates the
whole probe table (Chromium 148.0.7778.96 page+Worker × direct/aggregate,
node v24.16.0 oracle + absent-binding sim + real `node:util/types`
differential, kernel PUBLIC-entry bundle); raw output committed at
`reference/no-coi-realm-probe-transcript-2026-08-29.json`. Committed test
carriers: parity 1–7, 10, 12 → `tests/no-coi/worker-realm-compat.no-coi.spec.ts`
(8 RED / 2 green today); parity 6 call-one sibling snapshot + parity 7
(direct+aggregate), 8, 9 → `worker-realm-compat.test.ts` added pins (green);
parity 11 → existing suite unmodified. RED target unless marked pin/green.

1. no-COI page+worker: `decode(bytes('hello'))` → `'hello'`; today
   `ReferenceError: SharedArrayBuffer is not defined` — probe row 8.
2. same: `decode()` → `''`; today same ReferenceError — probe row 8.
3. same: shared-wasm Uint8Array view AND DataView, 'hello' bytes at offset 3,
   len 5 → `'hello'` each (Node probe row 3 — native differential recorded for
   BOTH view classes: Chromium native rejects both, Node native decodes both,
   transcript `native.sharedView`/`native.sharedDataView`); today
   ReferenceError patched / `TypeError: … must not be shared` native.
4. same: raw shared-wasm buffer → whole-buffer text pinned EXACTLY as
   `{length: 65536, sha256}` of the decoded text, Node-identical (probe row 4,
   digest `c0a9261d…` in the transcript); today ReferenceError patched /
   `TypeError: … parameter 1 is not of type 'ArrayBuffer'` native.
5. same: `é` split across two shared-backed views, `{stream:true}` then final,
   ONE decoder → `'é'` (Node probe row 6); today ReferenceError — probe row 8.
6. no-COI page+worker aggregate: sibling effects snapshot IMMEDIATELY after
   the FIRST `installWorkerRealmCompat()` call — `global === globalThis`;
   `self` own writable data prop, pre-write value `globalThis`
   (`Object.hasOwn` + descriptor), then assignment kept; decode at call one;
   `decode.__riftyShared === true` — global/self green today (probe row 9),
   call-one decode RED (row 8).
7. install idempotence: first direct install `true` (green today, probe row 7);
   second call (direct and aggregate repeat) → `false` AND strict-identity
   patched fn AND shared decode still green — identity pin (today only
   booleans are checked).
8. COI/unit, injected rejecting decoder: shared buffer filled with sentinel
   bytes, view at offset 3 len 5 → decoded text = exactly the view's 5 bytes,
   sentinels never included; same sweep for DataView over shared buffer and
   the raw-SharedArrayBuffer branch — offset/length exactness pin.
9. COI/unit, spy decoder: non-shared typed view / DataView / ArrayBuffer /
   no-arg → spy receives the EXACT same input object and opts object (`===`);
   a sentinel error thrown by the spy propagates as the SAME object (shared
   path post-copy too) — identity + error-propagation pins.
10. no-COI page+worker, built util-types:
    `isSharedArrayBuffer(new ArrayBuffer(1))` → `false`,
    `isAnyArrayBuffer(…)` → `true`, shared-wasm buffer → `true`/`true`, no
    throw — GREEN (probe rows 10–11); pin in the substrate. Node column =
    REAL `node:util/types` on the same inputs (transcript `utilTypesNative`
    rows, both predicates × private/shared-wasm) — a rifty-rerun-in-Node is
    not an oracle.
11. COI/SAB realm: existing shared-copy / pass-through / idempotence tests
    stay green unmodified.
12. no-COI page+worker, direct AND aggregate: `SharedArrayBuffer` defined as a
    counting+throwing accessor AFTER install → full patched-decode sweep
    (bytes/no-arg/shared view/DataView/raw buffer/streaming) returns the
    parity-1–5 outputs with binding-access count EXACTLY 0; prior binding
    state restored. Today count 6, every decode
    `POISON: bare SharedArrayBuffer binding evaluated` (probe row 13) — a
    try/catch-over-bare-reference implementation passes 1–5 but fails here.

## Fault matrix

| axis × operation | honest outcome | fault target |
|---|---|---|
| no-SAB-binding realm × install (direct/aggregate) | patch installs (`true`), marker set; aggregate siblings — global alias + OWN writable data `self` — observable at call ONE, pre-write (`observable-order` + self `lossy-aggregate` killed); nothing gates on the absent binding (`frozen-assumption` killed by probe row 2) | parity 1–2, 6–7 substrate REDs |
| no-SAB-binding realm × decode(shared-wasm Uint8Array/DataView/raw buffer, nonzero offset, streaming) | copy-into-private, Node-identical: 'hello' per view class (`sibling-drift` killed on DataView), raw buffer exact length+SHA-256 (`lossy-aggregate` killed), streaming state kept | parity 3–5 REDs |
| no-SAB-binding realm × decode(non-shared / no-arg) | pass-through, Node-identical | parity 1–2 REDs |
| SAB realm, native rejects shared × decode(shared view/DataView/raw SAB) | copy path, EXACT view bytes — sentinel + nonzero offset (`lossy-aggregate` killed) | parity 8 pin |
| SAB realm × decode(non-shared) | exact input/opts object identity through; thrown error object identity through (`lossy-aggregate` killed) | parity 9 pins |
| any realm × repeat install | `false`, strict-identity patched fn, shared decode intact (`lossy-aggregate` killed) | parity 7 pin |

## Out of scope

- No warn and no capability-report row for this shim — decode is fully
  Node-faithful post-fix, nothing degraded; the report surface is
  composition-fog scope (goal map §Fog; ADR-0367 §1).
- Kernel direct SAB constructors ARE reachable no-COI via public exports:
  `createSabRing` (kernel `index.ts:32` → `sab-ring.ts:136`),
  `spawnKernelWorker` (dies at its FIRST constructor, `spawn-worker.ts:395`,
  before any Worker exists) and the retained second constructor
  `createWorkerOutputState` (`worker-stdio-drain.ts:119`) ALL throw raw
  `ReferenceError: SharedArrayBuffer is not defined` in the real no-COI page —
  probe row 12 sweeps them through a bundle of the PUBLIC
  `kernel/src/index.ts` entry (checkpoint-4 B5: a removed public export or
  broken `spawnKernelWorker` fails the probe, never passes silently). Loud
  crash, wrong name: the NAMED loud capability gate/report is composition-fog
  scope (goal I1; ADR-0367 §1) — held on the goal map (§Fog + probe row 12).
  Prior sweep claim "unreachable behind the typeof gate" corrected
  (`provenance-lie` killed).
- child_process sync family no-COI: ONLY `execSync` carries the named loud
  `NotImplementedError` (`child_process-sync.ts:65`; its
  `isSabIpcSupported()` gate is absent-binding-safe — `capabilities.ts:25`
  typeof). `spawnSync`/`execFileSync` are ABSENT exports
  (`child_process.ts:664` exports spawn, exec, execFile, fork, execSync only)
  → call-site `TypeError: … is not a function`, no compat ❌ row — recorded in
  `runtime-js/node-builtins-loud-stub-capability-gaps` absent list this
  commit. Prior "execSync/spawnSync loud error stays" claim corrected
  (`provenance-lie` killed); map Out of scope line fixed same commit.
- Other no-COI degradations (spawn stdio pipe, cpus→1, worker_threads
  warn-once) — sibling slices.

## Decisions

- Re-cut 2026-08-29 in place after Contract+RED checkpoint 1 (14-blocker
  batch; same branch, lineage carries). Pre-re-cut clauses quoted for the
  checkpoint diff: Decisions `Guard = feature-detect at install: typeof
  SharedArrayBuffer !== 'function' → return false, never patch`; Acceptance
  `installSharedMemoryTolerantTextDecoder there returns false and leaves
  TextDecoder.prototype.decode untouched (no __riftyShared marker)`; Fault row
  `no shared input physically possible: Chromium gates SAB and wasm shared
  memory on COI`. All rested on one frozen assumption the real probe killed:
  Chromium 148 does NOT gate shared `WebAssembly.Memory` on COI (probe rows
  2–4). The correction STRENGTHENS the contract under the Node oracle (patch
  installs everywhere; more input classes decode; every previously promised
  observable — 'hello', '' — kept) — no user-observable fork, no demotion.
- Fix carrier = realm-safe shared-input detection inside the patched body (no
  bare `SharedArrayBuffer` evaluation on any path); exact mechanism (brand
  check / `!(buf instanceof ArrayBuffer)` complement / captured constructor)
  is implementation-owned; the contract pins observables only.
- ADR-0162 decision 3 (TextDecoder patch UNCONDITIONAL, feature-detect probe
  rejected) unchanged and re-affirmed — the prior re-cut's conditional no-op
  would have contradicted it without a successor; this contract doesn't. No
  ADR needed: internal patched-body fix.
- Map util-types open question settled 2026-08-29 (fog line since removed from
  the map — evidence lives here + ledger): util-types is
  brand-based (`Object.prototype.toString`), zero runtime SAB references
  (`npx esbuild packages/runtime-js/src/builtins/util-types.ts --format=esm |
  grep SharedArrayBuffer` → type positions/string literals only); real no-COI
  Chromium behavior Node-identical incl. shared-wasm buffer (probe rows
  10–11). No guard needed; parity 10 pins it in the substrate.
- Prod-source sweep corrected (2026-08-29): runtime-evaluated bare
  `SharedArrayBuffer` reachable from a no-COI realm = worker-realm-compat.ts
  75,80 (this unit) AND kernel constructor sites via PUBLIC
  `createSabRing`/`spawnKernelWorker` (probe row 12 — routed to the map's
  composition fog, see Out of scope). Prior "kernel sites worker-spawn-only behind the typeof
  capability gate" held only for the runtime-js spawn path, not direct public
  entries.
- RED substrate carrier (which lane / how the headerless page is served) was
  implementation-owned; settled by the checkpoint-2 re-cut: dedicated
  Playwright lane `playwright.no-coi.config.ts` + `tests/no-coi/` (plain
  `node:http` headerless server). Observables unchanged: real Chromium, both
  realm preconditions, real built shim, page + dedicated Worker.
- Re-cut 2026-08-29 (2nd) in place after Contract+RED checkpoint 2 (5
  blockers: C1–C4 + G1; same branch, attempt 3, lineage carries).
  fault-classes §Contract escalation applied — 2nd consecutive Contract+RED
  blocker → re-refine in place; NO split: one behavior, one fix carrier, the
  blockers were missing committed carriers/artifacts + one provenance claim,
  not a scope fork. Pre-re-cut clauses quoted for the checkpoint diff:
  Context `installNodeRuntime (install-process.ts:117) runs it in every Node
  realm` → corrected to kernel-pre-entry-only + public-worker-entry-never
  (G1); Parity intro `every row's artifact = probe §2026-08-29 row (command +
  output …)` → replayable driver + committed transcript (C4); Acceptance
  `committed in the same PR as the fix` → substrate + COI pins committed at
  this checkpoint (C1–C3). No observable promise weakened — every previously
  declared decode outcome, identity pin, and error identity kept verbatim; no
  demotion (no user-observable fork).

- Re-cut 2026-08-29 (3rd) in place after Contract+RED checkpoint 3 (12
  blockers; same branch, attempt 4, lineage carries; batch, no split — one
  behavior, blockers were exactness/order/provenance gaps in the pins plus
  goal-drift in the map, not a scope fork). Pre-re-cut clauses quoted for the
  checkpoint diff: parity 4 asserted a `{length, atOffset, nonNul}` PROJECTION
  → exact length+SHA-256 (`lossy-aggregate`); probe recorded aggregate
  `globalAlias`/`selfWritable` only after the repeat install and compared
  `self` post-write → call-one snapshot + pre-write value + `Object.hasOwn` +
  writable-data descriptor (`observable-order`, `lossy-aggregate`);
  `patched.sharedDataView` was recorded but never asserted and native rows
  omitted DataView → asserted in all four combos + native differential row
  (`sibling-drift`, `frozen-assumption`); parity 10 "Node oracle" re-ran rifty
  util-types in Node → REAL `node:util/types` differential rows
  (`provenance-lie`); unused `startNoCoiServer` root knob cut (§Simplicity);
  harness headers trimmed to load-bearing rationale. Goal-side same
  checkpoint: I2 organic-reachability claim demoted from "certification
  recorded on build-loop" to map Open question "installNodeRuntime seam";
  build-loop + dev-hmr UNSEEDED (FIT §5 — contracts depended on open
  questions; drafts deleted, scope back to map fog, durable evidence stays in
  `reference/` + hmr spike record); map item-1 narrative and settled
  util-types paragraph cut (map = index, not store). Every previously declared
  decode outcome, identity pin, and error identity kept verbatim — pins only
  STRENGTHENED under the same oracles; no user-observable fork, no demotion of
  this contract. Still 7 RED + 2 green, inside the declared 5–8 band.

- Re-cut 2026-08-29 (4th) in place after Contract+RED checkpoint 4 (batch;
  same branch, attempt 5, lineage carries; no split — one behavior, blockers
  were one weak observable, two provenance/process gaps, and goal/map-side
  authority gaps, not a scope fork). Pre-re-cut clauses quoted for the
  checkpoint diff: "decode NEVER evaluates the absent binding" was pinned by
  output rows alone — a try/catch over the bare identifier passes them →
  poisoned counting+throwing accessor after install, count EXACTLY 0, direct
  AND aggregate, prior binding state restored (parity 12, probe row 13; B3
  `frozen-assumption`); "existing `worker-realm-compat.test.ts` stays green
  unmodified" while checkpoint 3 had RENAMED+EDITED the pre-existing
  installWritableSelf test → restored byte-identical to main (branch diff of
  that file additions-only), strengthened pin ADDED as a SEPARATE test (B4);
  probe row 12 bundled PRIVATE `ipc/sab-ring.ts`, so a removed public export
  or broken `spawnKernelWorker` passed silently → PUBLIC `kernel/src/index.ts`
  bundle sweeping `createSabRing` + `spawnKernelWorker` + retained
  `createWorkerOutputState` (B5 `provenance-lie`; reference doc rows 12–13 +
  transcript regenerated). Goal-side same checkpoint: the goal's IRREVERSIBLE
  choices got ADR carriers — ADR-0367 (semantic capability report ADDITIVE to
  the untouched public `checkCapabilities` probe; restart/died-event beside
  the dispose()-only lifecycle; cpus→1 divergence), ADR-0368 (OPFS selection
  drops the ADR-0072 `crossOriginIsolated &&` clause — dated correction note +
  README row, not a postponed draft), ADR-0369 (headerless no-COI Playwright
  lane); map: leftover build-loop/dev-hmr pseudo-items dissolved into UNSLICED
  fog (FIT §5), installNodeRuntime-seam settlement re-assigned from the
  owning slice's own later Contract+RED (illegal fog→pickup transition, B6)
  to a DELIVERABLE of the first slice composing the no-COI runtime. Every
  previously declared decode outcome, identity pin, and error identity kept
  verbatim; no user-observable fork, no demotion. Now 8 RED + 2 green, inside
  the declared 5–8 band.

## Reversibility

REVERSIBLE — internal patched-body fix, no public surface, no ADR
contradiction (ADR-0162's unconditional stance kept).
