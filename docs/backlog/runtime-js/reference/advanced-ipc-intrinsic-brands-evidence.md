# Advanced IPC intrinsic brands — pending scope decision

Native Node24.16.0; Chromium148. Independent Final @0b8daa7bd found
WeakMap/WeakSet/Promise/SharedArrayBuffer/WeakRef/FinalizationRegistry
foreign or prototype-erased instances accepted as ordinary records.
Authority: advanced IPC Acceptance2 → I4; ADR-0446/0453.

## Executed RED and repair

- `pnpm exec vitest run packages/runtime-js/src/internal/node-ipc-advanced.test.ts`:
  original implementation 6 failures/8 passes. Frozen foreign/severed values,
  enumerable throwing getter must remain unread; native clone rejects first.
- `pnpm test:parity public-ipc-advanced-fault`: real native versus physical
  Worker; both senders incorrectly dispatch six severed intrinsic siblings.
- Captured slot methods/getters repair five brands. Private fresh unregister
  token cannot remove a guest registration; WeakRef success is distinct from
  an undefined deref result. Promise remains the explicit native-parity RED.

## Concrete candidate, not an accepted contract change

A private throwing constructor plus captured Promise.resolve can classify an
object while its own constructor temporarily names that private constructor.
PromiseResolve returns a real Promise unchanged; for an ordinary object it
constructs the private thrower before reading then. Finally restores the exact
original descriptor. Proxy rejection precedes reflection. No promise reaction,
species or guest getter executes; rejected Promise stays unhandled.

Independent decision probes: Node24 16 cases, Chromium148 8 cases, foreign/local,
plain/Promise, missing/configurable-accessor/sealed-writable constructor:
correct brand, zero getters, exact restoration. Frozen/read-only constructor
cannot use this technique. Promise.prototype.then changes rejection handling;
Object.toString loses the erased brand; native-clone plus a second walk repeats
getters and loses getter-returned Buffer provenance. Global mutation facades
would add a much broader owner and still miss pre-frozen foreign ingress.

Candidate throws `NotImplementedError('child_process.serialization.advanced.opaque-brand')`
for ambiguous ordinary objects when constructor cannot temporarily change:
non-extensible without an own constructor, or nonconfigurable accessor/read-only
constructor. Known slot brands/arrays bypass this probe. This deliberately also
rejects affected plain frozen records; it is NOT native-equivalent serialization.

- Real physical both-sender differential for all six editable severed intrinsic
  types: native output equals rifty; channel remains connected, valid messages1/2
  ordered, no failed message dispatched.
- `RIFTY_PLAYGROUND_PORT=5447 pnpm exec playwright test tests/e2e/owner-shell-vitest.spec.ts --project=chromium-heavy --workers=1`:
  exact unchanged Vitest scenario10runs PASS,47.2s (53.0s total).
- Codec/VM tests29PASS; unchanged frozen-Promise native-error assertion remains
  RED. Do not relabel this as Final+GREEN or narrow that assertion silently.

User asked whether to accept the explicit locked-object ceiling. No answer yet;
full IPC contract and goal.md remain unchanged. Candidate is reviewable work,
not accepted delivery. I7 watch/other-version question is independently pending.

Candidate runtime-js typecheck PASS; public kernel-export assertion and unchanged
negative compiler-payload tests11PASS. Production5448 failed before any IPC:
Proxy provenance authority sealed before trusted workbench-owner bundle loads.
Five boot failures, one interrupted, two not run; separate required regression
repair, no production proof claimed. The compiler asset fingerprint remains
pending the final source rebuild, with its unchanged size/cap/negative tests.

## Shared-view sibling repair

Direct SAB is rejected; its typed views are valid Node IPC values. Browser clone
retains shared memory, so a later getter/post-send write changed the receiver.
`node-ipc-advanced-shared-views.test.ts`:12 families × getter/post-send plus
per-view encounter/alias case,25RED→25GREEN. A captured-intrinsic helper copies
only the visible bytes at each encounter, preserving raw bits and repeated
view identity; distinct views do not share writes. Existing rich physical IPC
fixture now covers Uint8Array/DataView in both directions and matches Node.
Native v8's packed backing allocation/offset layout is not reproduced; this
repair concerns values/snapshots, not that pre-existing allocation difference.

Scoped codec54PASS; unchanged frozen-Promise criterion excluded explicitly,
not relabelled. Full contract remains RED. Separate candidate guard tests6PASS:
constructor descriptors restored, zero premature getter reads, and an isolated
real Node rejection still emits unhandledRejection with the original Promise.

## Exact compiler fingerprint refresh

After the bootstrap repair build: typescript-worker.js10,022,748bytes,
SHA256c5ac589d55ce145febf6eb66d8535bbbd61aa01912cdc59d97aa8d4cad8fbed2.
Against the available main-checkout artifact, after normalizing only existing
chunk/module-loader import hashes, the entire diff is the seal function import
and one boot call:54bytes. TypeScript compiler body unchanged. This comparison
is not an exact rebuild of the old pinned SHA; no such claim is made.
ADR-0391 exact name/size/hash pin refreshed; global2MB ceiling, other compiler
pin and all negative payload checks remain unchanged. Real production editor
and packed-consumer proofs still pending at this record.

Production5449 after repair: full8/8PASS3.3m, including TypeScript editor F12
and real diagnostics, owner startup, Buffer identity, Express/SQLite, Hono,
Koa and Webpack HMR/reload. Exact compiler pin gate plus10 negative payload
testsPASS. Packed-consumer and full PR gate run separately; the user scope
questions remain open.
