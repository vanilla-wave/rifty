---
area: runtime-js
status: draft
title: worker-realm-compat TextDecoder shim throws ReferenceError in realms without SharedArrayBuffer
created: 2026-08-26
why: without COI Chromium defines NO `SharedArrayBuffer` global binding; the shim's bare references make EVERY decode() in that realm throw ReferenceError — yet shared `WebAssembly.Memory` views EXIST there and Node decodes them, so the patch is needed, realm-safe
user_story: As a dev on the no-COI fallback tier, I want TextDecoder to keep working, but today `installSharedMemoryTolerantTextDecoder`'s patched decode references bare `SharedArrayBuffer` and throws `ReferenceError` on every call in a realm where the binding is absent.
epic: no-coi-sandbox-tier
sources: [docs/backlog/runtime-js/reference/no-coi-degradation-probes.md, docs/backlog/runtime-js/reference/no-coi-realm-probe-transcript-2026-08-29.json, tools/probes/no-coi-realm-probe.mjs]
code: [packages/runtime-js/src/ipc/worker-realm-compat.ts, packages/runtime-js/src/ipc/install-process.ts]
---

## Demotion — checkpoint 8, 2026-08-30 (ready → draft, fork recorded)

Per decision-workflow §Backlog readiness 5 + fault-classes §Contract
escalation (re-refine arm; attempt 9). Pre-demotion Acceptance/Parity
verbatim: `reference/bare-sab-guard-pre-demotion-2026-08-30.md` — this re-cut
only ADDED observables; nothing below is weakened.

THE FORK (user-owned, manual `rifty-refine` requested): the unit's
Contract+RED batch is 12 declared-RED substrate blocks against a 3–5 pickup
band; the Budget rule ("expected-RED batch far above the declared band → the
unit is too big: re-cut/split before implementation", backlog README §Goal
run; PICKUP step 3 "far above any prior estimate → split it now") was ruled
uncured by the checkpoint-7 split (it moved only green tooling). No honest
in-place cure remains: (a) every candidate split of the RED batch yields a
unit with no independent deliverable — the fix is ONE atomic patched body
(worker-realm-compat.ts:75,80), so a second unit's REDs would flip green with
zero code of its own, violating §Simplicity and "one PR = one reviewable
delivered behavior"; (b) band re-declaration alone was rejected at review
checkpoints 7–8; (c) shrinking the batch means dropping substrate carriers of
review-added wrapper-killer pins (parity 6/7/9/12/13/14 in-realm rows) — an
observable weakening of what the fix's acceptance PROVES in the real no-COI
realm, never the agent's call. Refine question: **stand the 12-block batch as
this unit's declared band (accept an over-band atomic-fix unit), or name
which substrate pin carriers demote to COI-vitest-twin-only guards (batch
shrinks into band; in-realm proof narrows accordingly), or split by a
boundary the user names.** Until answered: draft — never implement.

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
  dedicated module Worker on it (probe §2026-08-29). The probe body GATES all
  realm preconditions — `crossOriginIsolated === false`,
  `typeof SharedArrayBuffer === 'undefined'`, shared `WebAssembly.Memory`
  buffer brand `[object SharedArrayBuffer]` with `instanceof ArrayBuffer`
  false — BEFORE any built-module import, install, or decode: a future
  Chromium change REJECTS loud, never acts first and fails a later assertion
  (recording-while-acting was the checkpoint-8 frozen-assumption blocker).
  Rejection-precedes-action is itself detection-pinned (green, page AND worker
  siblings): a wrong-brand realm sim makes `runProbe` throw the named
  precondition error with side-effect sentinels — no `/dist/` built module
  ever requested, realm decode left unmarked (probe row 19). Realm provenance
  beyond derived state (BOTH isolation headers absent on every ACTUALLY
  CONSUMED response class with status 200, injection- AND absent/non-200-
  control-pinned — probe row 16) is the substrate-lane item's contract:
  `toolchain-build/no-coi-substrate-lane` (split checkpoint 7).
- Approximation rejected: stubbing `SharedArrayBuffer = undefined` in a
  COI/Node realm is NOT this realm (`instanceof undefined` TypeError, not the
  absent-binding ReferenceError); the RED must run in the real no-COI browser
  realm with the real built shim.

## Acceptance

- RED-first on a real no-COI Chromium substrate — headerless page AND dedicated
  module Worker, exercising the real built shim (not a source copy), both
  asserting the Reference-contract preconditions before acting. Lane, header
  provenance, required `no-coi-chromium` CI job + gate mapping, and the replay
  driver are the split sibling's contract
  (`toolchain-build/no-coi-substrate-lane` — checkpoint 7). THIS unit's
  committed carrier: `tests/no-coi/worker-realm-compat.no-coi.spec.ts` — today
  12 declared-RED blocks (parity 1–7, 9, 13, 14, 15 — every decode failure
  `ReferenceError: SharedArrayBuffer is not defined`; parity 12, every
  poisoned decode trips the counting accessor) + green pins (preconditions
  incl. consumed-response header provenance, parity 10, precondition-rejection
  detection ×2). The RED batch is runner-DECLARED (`test.fail(true,
  EXPECTED_RED)`, checkpoint 8 — kills the checkpoint-7 map cycle): every RED
  still EXECUTES on the required `no-coi-chromium` job and must fail; an
  unexpected pass fails the job LOUD, so the fix PR must strip exactly the 12
  annotations to go green — assertions are NEVER edited; the RED→GREEN flip is
  machine-detected, not narrated.
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
  EXACT input and opts objects, RETURNS the decoder's unique per-call sentinel
  unchanged, and propagates the exact thrown error object (Parity 8–9).
  COMMITTED (checkpoint-2 C2/C3): added describes in
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
- Ordered exact-call log (parity 13 — output and error-identity rows alone
  admit a try-native/catch/copy-retry wrapper that invokes the ORIGINAL
  decoder on the shared input first): with a logging decoder as the original,
  a decode sweep across the FULL declared class set — private view / private
  DataView / private ArrayBuffer / no-arg / shared Uint8Array view / shared
  DataView / raw SAB / streaming pair — direct AND aggregate carriers —
  invokes the original EXACTLY once per decode, in order; EVERY call on a
  shared source receives a private (non-shared) input that is never the
  source object, bytes exact against sentinels (raw row as length+SHA-256),
  opts object exact per call (incl. the `{stream:true}`/final pair); unique
  sentinel returns come back unchanged. TWO carriers: COI vitest green pins
  AND the substrate probe `exactCallLog` in page+worker × direct/aggregate —
  RED today, ReferenceError before the original is ever invoked (probe
  row 17) — a SAB-present-only shared-streaming or DataView/raw native-first
  branch passes a Uint8Array-only `stream:false` log. Sibling first-error
  pins (parity 9): a fresh-error-per-call decoder propagates the FIRST thrown
  object with throw count EXACTLY 1, browser AND Node (a retry wrapper throws
  twice and propagates the second) — swept with fresh TypeErrors across EVERY
  shared class (view/DataView/raw/streaming, probe row 18) AND every private
  sibling + no-arg (priv view/DataView/ArrayBuffer/no-arg — a reused sentinel
  lets a private-only retry rethrow the same object unnoticed), AND every
  declared `{stream:false}` sibling under an EXPLICIT `{stream:false}` opts
  object (priv/privDataView/privArrayBuffer/sharedView/sharedDataView/raw —
  every base row omits opts or passes `{stream:true}` and the exact-call
  log's stream:false rows use a NONTHROWING logger, so a wrapper retrying
  only a THROWN `opts.stream===false` call would pass both; transcript
  `identity.errorFirstOptsFalse`) INCLUDING the streaming pair's FINAL call
  (original RETURNS on `{stream:true}`, fresh-throws on the final: first
  error, count 1, original invoked EXACTLY twice — `originalCalls`, killing a
  pair-replaying wrapper), AND through the REALM's global TextDecoder via
  BOTH real carriers, full 15-class set (per class: realm decode swapped to
  an unmarked fresh-TypeError original, re-install direct/aggregate, one
  decode — transcript `errorFirstRealm`; the injected rows alone admit a fix
  retrying fresh errors only for the absent-binding realm's global decoder).
  COI vitest twins direct+aggregate for shared, private, AND stream:false
  sets incl. the streaming final: a wrapper retrying only on TypeError, only
  for non-Uint8Array classes, only failing private inputs, only thrown
  stream:false calls, or only on the realm global, fails the sweep.
- Mixed install order (parity 14): a direct helper install FIRST, then the
  realm's FIRST `installWorkerRealmCompat()` — decoder identity stays the
  captured patched fn AND global/self siblings still install AND decode green
  at that call; an aggregate-level early return keyed on the decoder marker
  passes every clean-aggregate combo but fails here. Today the decode is the
  ReferenceError RED; siblings green (probe row 14).
- COI behavior unchanged: every pre-existing test in
  `worker-realm-compat.test.ts` stays green and byte-identical to main (the
  branch diff of that file is additions only); strengthened pins are ADDED,
  never edited-to-pass.

## Parity cases

Oracles per Reference contract; every row's artifact is REPLAYABLE via the
lane item's evidence driver (`node tools/probes/no-coi-realm-probe.mjs` —
mechanics + kernel goldens: `toolchain-build/no-coi-substrate-lane`); raw
output committed at
`reference/no-coi-realm-probe-transcript-2026-08-29.json`. Committed test
carriers: parity 1–7, 9, 10, 12, 13, 14, 15 →
`tests/no-coi/worker-realm-compat.no-coi.spec.ts` (12 declared-RED /
4 green today — preconditions incl. row-16 consumed-response provenance,
parity 10, precondition-rejection detection page+worker);
parity 6 call-one sibling snapshot + parity 7 (direct+aggregate), 8, 9, 13
(full class set + fresh-TypeError first-error sweeps — shared, private/no-arg,
AND explicit stream:false incl. the streaming final) →
`worker-realm-compat.test.ts` added pins (22 green);
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
9. COI/unit AND no-COI page+worker probe, spy decoder returning UNIQUE
   per-call sentinels: non-shared typed view / DataView / ArrayBuffer /
   no-arg → spy receives the EXACT same input object and opts object (`===`)
   AND the wrapper returns the sentinel unchanged (exact objects to the
   original + fabricated output = fail); a sentinel error thrown by the spy
   propagates as the SAME object (shared path post-copy too); on SHARED-wasm
   input a fresh-error-per-call decoder propagates the FIRST thrown error
   with throw count EXACTLY 1 (browser + Node — probe
   `identity.errorIdentitySharedFirst`; today no-COI every row
   ReferenceError / `{first:false, throwCount:0}` — RED in the substrate,
   green COI pins). Sibling sweeps with fresh TypeErrors (probe row 18; COI
   vitest twins direct AND aggregate): EVERY shared class — shared view /
   DataView / raw buffer / streaming `{stream:true}`
   (`identity.errorFirstShared`) — AND every private sibling + no-arg — priv
   view / DataView / ArrayBuffer / no-arg (`identity.errorFirstPrivate`) —
   AND every declared `{stream:false}` sibling under an EXPLICIT
   `{stream:false}` (priv/privDataView/privArrayBuffer/sharedView/
   sharedDataView/raw, `identity.errorFirstOptsFalse` — base rows omit opts
   and the exact-call logger never throws, so a wrapper retrying only a
   THROWN `opts.stream===false` call passes both) incl. the streaming pair's
   FINAL call (original returns on `{stream:true}`, fresh-throws on the
   final: `{first:true, throwCount:1, originalCalls:2}` — a pair-replaying
   wrapper calls 3+, a retry throws twice) — AND the REALM's global
   TextDecoder through BOTH real carriers, full 15-class set (per class:
   realm decode swapped to an unmarked fresh-TypeError original, re-install
   direct/aggregate, one decode — `errorFirstRealm.direct`/`.aggregate`):
   `{first:true, throwCount:1}` each — a native-first wrapper retrying only
   on TypeError passes the generic-Error row; a Uint8Array-only row misses a
   DataView/raw/streaming retry branch; a private-only retry rethrows a
   REUSED sentinel unnoticed (fresh error + count 1 kills it); an
   injected-classes-only sweep misses a fix retrying fresh errors only for
   the absent-binding realm's global decoder.
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
13. COI/unit AND no-COI page+worker probe, logging decoder as the original,
    direct AND aggregate carriers (aggregate = realm decoder swapped to an
    unmarked logging original, then `installWorkerRealmCompat()`): ordered
    exact-call log across the FULL class set — priv view / priv DataView /
    priv ArrayBuffer / no-arg / shared Uint8Array view / shared DataView /
    raw SAB / streaming pair — original invoked EXACTLY once per decode, in
    order; EVERY shared-source call carries a private non-shared input (never
    the source object, bytes exact vs sentinels — raw row length+SHA-256
    `167c274d…`, opts object exact per call); unique sentinel returns
    unchanged (probe row 17, transcript `exactCallLog`). COI vitest green
    pins; substrate RED today (ReferenceError before the original is ever
    invoked) — kills try-native/catch/copy-retry, which parity 8–9 outputs
    alone admit, incl. SAB-present-only streaming or DataView/raw-only
    branches a Uint8Array-only `stream:false` log misses.
14. no-COI page+worker (direct-mode realms): direct helper install FIRST,
    then the realm's FIRST `installWorkerRealmCompat()` → decoder strictly
    `===` the captured patched fn AND marker AND `global` alias AND own
    writable-data `self` AND `decode(bytes('hello'))` → `'hello'`, snapshot
    immediately after that call. Today siblings green, decode ReferenceError
    (probe row 14) — an aggregate early return on the already-marked decoder
    passes clean aggregate combos but fails here.
15. no-COI page+worker, direct AND aggregate, realm decoder, non-shared
    sibling classes: `decode(new DataView(bytes('hello').buffer))` AND
    `decode(bytes('hello').buffer)` → `'hello'` each (Node probe row 15);
    today ReferenceError.

## Fault matrix

| axis × operation | honest outcome | fault target |
|---|---|---|
| no-SAB-binding realm × install (direct/aggregate) | patch installs (`true`), marker set; aggregate siblings — global alias + OWN writable data `self` — observable at call ONE, pre-write (`observable-order` + self `lossy-aggregate` killed); nothing gates on the absent binding (`frozen-assumption` killed by probe row 2) | parity 1–2, 6–7 substrate REDs |
| no-SAB-binding realm × decode(shared-wasm Uint8Array/DataView/raw buffer, nonzero offset, streaming) | copy-into-private, Node-identical: 'hello' per view class (`sibling-drift` killed on DataView), raw buffer exact length+SHA-256 (`lossy-aggregate` killed), streaming state kept | parity 3–5 REDs |
| no-SAB-binding realm × decode(non-shared / no-arg) | pass-through, Node-identical | parity 1–2 REDs |
| SAB realm, native rejects shared × decode(shared view/DataView/raw SAB) | copy path, EXACT view bytes — sentinel + nonzero offset (`lossy-aggregate` killed) | parity 8 pin |
| SAB realm × decode(non-shared) | exact input/opts object identity through; unique sentinel RETURN through unchanged; thrown error object identity through (`lossy-aggregate` killed twice — objects AND returns) | parity 9 pins |
| any realm × decode(any class) through the patched fn | original decoder invoked EXACTLY once, ordered log over the FULL class set — priv view/DataView/ArrayBuffer, no-arg, shared view/DataView/raw, streaming; every shared-source call = private copy, never the original on shared input; first-error identity with throw count 1, fresh-TypeError swept per shared class AND per private class + no-arg AND per explicit `{stream:false}` sibling incl. the streaming FINAL call (originalCalls EXACTLY 2) AND through the realm decoder direct+aggregate, 15 classes (`observable-order` try-native-retry killed; `sibling-drift` catch-TypeError / class-scoped / private-only / thrown-stream:false-only / realm-global-only retry killed) | parity 13 COI pins + substrate REDs (probe row 17); parity 9 first-error + row-18 sweeps incl. `errorFirstOptsFalse` |
| wrong-brand realm × runProbe | loud NAMED precondition rejection BEFORE any built-module import/install/decode; side-effect sentinels prove order — no `/dist/` request, decode unmarked (`frozen-assumption` record-then-act killed, `observable-order` preserved) | precondition-detection green pins, page+worker (probe row 19) |
| substrate lane × served response headers | consumed-response provenance + injection + absent/non-200 controls — `toolchain-build/no-coi-substrate-lane` (split checkpoint 7) | lane item fault matrix (probe row 16) |
| no-SAB realm × direct install then FIRST aggregate call | sibling installers still run (global alias, own writable `self`), decoder identity kept, decode green (`observable-order` marker-early-return killed) | parity 14 RED |
| any realm × repeat install | `false`, strict-identity patched fn, shared decode intact (`lossy-aggregate` killed) | parity 7 pin |

## Out of scope

- No warn and no capability-report row for this shim — decode is fully
  Node-faithful post-fix, nothing degraded; the report surface is
  composition-fog scope (goal map §Fog; ADR-0367 §1).
- Kernel direct SAB constructors ARE reachable no-COI via public exports:
  `createSabRing` (kernel `index.ts:32` → `sab-ring.ts:136`),
  `spawnKernelWorker` (dies at its FIRST constructor, `spawn-worker.ts:395`,
  with EXACTLY ZERO `Worker` constructions — checkpoint 5: a counting `Worker`
  constructor wraps the probe sweep, every call records
  `workerConstructions: 0` and the replay driver fails LOUD on nonzero, so
  Worker construction cannot silently move ahead of the SAB throw) and the
  retained second constructor `createWorkerOutputState`
  (`worker-stdio-drain.ts:119`) ALL throw raw
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
  realm preconditions, real built shim, page + dedicated Worker. Lane
  mechanics/provenance/CI/driver contract since split out:
  `toolchain-build/no-coi-substrate-lane` (checkpoint 7).

- Re-cut lineage, checkpoints 1–6 (compacted checkpoint 7 — approach-cost
  blocker: quoted-clause narratives duplicated the contract; ONE authority =
  this file's current sections + the committed transcript; full per-checkpoint
  text in this file's git history). Every checkpoint: same branch, batch
  re-cut in place, observables only STRENGTHENED under the same oracles — no
  user-observable fork, no demotion.
  - ckpt 1, 2026-08-29 (14 blockers, attempt 2): direction flip — spike-era
    no-op guard killed by the real probe (shared wasm memory exists no-COI);
    fix = unconditional realm-safe patch.
  - ckpt 2, 2026-08-29 (5, attempt 3; §Contract escalation, re-refine no
    split): substrate + COI pins committed; probe made replayable; I2 install
    mapping corrected.
  - ckpt 3, 2026-08-29 (12, attempt 4): exactness/order pins — raw-buffer
    digest, call-one sibling snapshot, DataView + real `node:util/types`
    differentials; build-loop/dev-hmr unseeded, map narrative cut.
  - ckpt 4, 2026-08-29 (10+2, attempt 5): poisoned-binding accessor
    (parity 12); baseline installWritableSelf test restored byte-identical;
    kernel PUBLIC-entry sweep; ADR-0367/0368/0369 carriers; fog dissolution +
    installNodeRuntime-seam re-assignment.
  - ckpt 5, 2026-08-30 (9, attempt 6): ordered exact-call log (parity 13),
    sentinel returns, shared first-error row, mixed sequence (parity 14),
    realm priv rows (parity 15), counting Worker constructor; lane wired
    REQUIRED in CI; ADR-0011 supersession recorded; goal.md restored to main.
    Band re-declared 8–12 (was 5–8).
  - ckpt 6, 2026-08-30 (4, attempt 7): response-header provenance sweep,
    fresh-TypeError shared sweep, full-class exact-call log + substrate
    carrier; opfs-policy-flip draft reconciled to ADR-0368. 12 RED + 2 green.
- Re-cut 2026-08-30 (7th) in place after Contract+RED checkpoint 7 (7-blocker
  batch; same branch, attempt 8, lineage carries). Completeness closed
  (details now IN the sections above — no duplicate narrative): parity 9
  fresh-error sweeps extended to private classes + no-arg AND to the realm's
  global TextDecoder through both real carriers, substrate + COI vitest
  twins; header provenance re-based from the in-page fetch sweep (blind to a
  `Sec-Fetch-Dest`-keyed server) to ACTUAL consumed-response observation with
  per-class × per-header injection controls; CI job→script→config→gate
  mapping pinned with a sibling sweep; kernel public-entry sweep given GOLDEN
  export+ReferenceError assertions. SPLIT per backlog README §Goal run ("an
  expected-RED batch far above [the declared band] → the unit is too big:
  re-cut/split before implementation"; Budget blocker — pickup band 3–5 grew
  to 12 across checkpoints without a split): lane mechanics, provenance
  harness, required CI job, and evidence driver moved verbatim-or-stronger to
  `toolchain-build/no-coi-substrate-lane` (ready, green, tooling-class; split
  re-cut names its predecessor — nothing weakened, no demotion). THIS unit's
  band re-declared as EXACTLY its 12 committed substrate REDs: the growth was
  review-added wrapper-killer pins on the ONE fix carrier, not scope — the
  separable scope is what split out. Ledger rows 7–11 and these Decisions
  compacted to lineage one-liners (approach-cost blocker). Transcript
  regenerated same command (Chromium 148.0.7778.96 / node v24.16.0). Still
  12 RED + 2 green.
- Re-cut 2026-08-30 (8th) in place after Contract+RED checkpoint 8 (9-blocker
  batch; same branch, attempt 9, lineage carries). Additions only (details in
  the sections above): parity 9 fresh-error sweeps extended to explicit
  `{stream:false}` siblings + the streaming FINAL call (`originalCalls`
  EXACTLY 2), all carriers; runProbe preconditions GATED (incl. shared-memory
  brand + instanceof) before any built-module import/install/decode, with
  wrong-brand detection pins + side-effect sentinels page+worker; kernel
  driver goldens hardened to actual-ReferenceError identity
  (instanceof/prototype/constructor) + total-zero Worker counter, and
  consumed-class absent/non-200 detection controls — both lane-item scope,
  carried in the same batch. RED batch runner-DECLARED via
  `test.fail(true, …)` — executed, loud on unexpected pass, fix PR strips
  exactly the annotations — making the split SERIAL (lane = map item 1, lands
  first; the checkpoint-7 cycle killed). Ledger rows 7–11 restored verbatim
  (the checkpoint-7 ledger compaction violated append-only; THIS doc's
  Decisions compaction stands — a contract re-cuts in place, the ledger only
  grows). Budget: unit DEMOTED to draft with the band fork recorded
  (§Demotion above) — manual `rifty-refine` requested. Transcript regenerated
  same command (Chromium 148.0.7778.96 / node v24.16.0); lane 32 green
  (12 declared-RED + 20 pins); vitest 22 green, still additions-only vs main.

## Reversibility

REVERSIBLE — internal patched-body fix, no public surface, no ADR
contradiction (ADR-0162's unconditional stance kept).
