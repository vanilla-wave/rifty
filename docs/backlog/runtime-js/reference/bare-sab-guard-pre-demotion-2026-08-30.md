# bare-sab-guard — pre-demotion Acceptance/Parity (verbatim)

Recorded at the checkpoint-8 demotion of
`runtime-js/worker-realm-compat-bare-sab-referenceerror` (2026-08-30, ready →
draft; decision-workflow §Backlog readiness 5): the next Contract+RED
checkpoint diffs the re-cut against THIS text — any weakening is a
user-observable fork → manual `rifty-refine`. Source tree: branch
`t3code/no-coi-sandbox-tier` @ 9c2c598e7 (checkpoint 7). The same checkpoint-8
batch then ADDED observables (stream:false first-error rows, precondition
gate + detection, declared-RED runner encoding) — additions only; the fork
under refine is the BAND, not any observable here.

## Acceptance

- RED-first on a real no-COI Chromium substrate — headerless page AND dedicated
  module Worker, exercising the real built shim (not a source copy), both
  asserting the Reference-contract preconditions before acting. Lane, header
  provenance, required `no-coi-chromium` CI job + gate mapping, and the replay
  driver are the split sibling's contract
  (`toolchain-build/no-coi-substrate-lane` — checkpoint 7; the required job
  keeps this unit's draft red until the fix, green to merge). THIS unit's
  committed carrier: `tests/no-coi/worker-realm-compat.no-coi.spec.ts` — today
  12 RED (parity 1–7, 9, 13, 14, 15 — every decode failure
  `ReferenceError: SharedArrayBuffer is not defined`; parity 12, every
  poisoned decode trips the counting accessor) + 2 green pins (preconditions
  incl. consumed-response header provenance, parity 10); flips GREEN in the
  fix PR, never edited to pass.
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
  lets a private-only retry rethrow the same object unnoticed), AND through
  the REALM's global TextDecoder via BOTH real carriers (per class: realm
  decode swapped to an unmarked fresh-TypeError original, re-install
  direct/aggregate, one decode — transcript `errorFirstRealm`; the injected
  rows alone admit a fix retrying fresh errors only for the absent-binding
  realm's global decoder). COI vitest twins direct+aggregate for shared AND
  private sets: a wrapper retrying only on TypeError, only for
  non-Uint8Array classes, only failing private inputs, or only on the realm
  global, fails the sweep.
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
`tests/no-coi/worker-realm-compat.no-coi.spec.ts` (12 RED / 2 green today;
the preconditions pin carries the row-16 consumed-response provenance);
parity 6 call-one sibling snapshot + parity 7 (direct+aggregate), 8, 9, 13
(full class set + fresh-TypeError first-error sweeps, shared AND
private/no-arg) → `worker-realm-compat.test.ts` added pins (green);
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
   AND the REALM's global TextDecoder through BOTH real carriers, full
   8-class set (per class: realm decode swapped to an unmarked
   fresh-TypeError original, re-install direct/aggregate, one decode —
   `errorFirstRealm.direct`/`.aggregate`): `{first:true, throwCount:1}`
   each — a native-first wrapper retrying only on TypeError passes the
   generic-Error row; a Uint8Array-only row misses a DataView/raw/streaming
   retry branch; a private-only retry rethrows a REUSED sentinel unnoticed
   (fresh error + count 1 kills it); an injected-classes-only sweep misses a
   fix retrying fresh errors only for the absent-binding realm's global
   decoder.
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
