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

Packed external consumer after cdf806fc9: PASS178.9s; installs only tarballs,
fresh independently reserved port/Chromium, preview/HMR and packaging proofs.
Full `pnpm pr:check`:23/25 lanesPASS; unit10636PASS/1FAIL/18SKIP and
parity297/298PASS. Both failures are the unchanged frozen-Promise native-error
criterion; failed unit file rerun once in isolation, stillRED. No test exclusion
in the full gate. `check:pass-binding` correctly remains RED: no current bound
Final+GREEN PASS; old MessagePort verdict remains historical evidence.

Final composed dev proof on the same production source cdf806fc9: fresh5450,
unchanged Vitest10runs + six installed/configured negative modes,2/2PASS2.1m.
CI run35821064164 production and hosted lanes PASS; parity reports exactly
public-ipc-advanced-fault and one failedcase. Other CI lanes still running at
this record; no all-green CI claim.

Independent whole-delivery verify @cdf806fc9: BLOCK, same B1 pending scope;
production/packed/lifecycle/bootstrap repairs accepted, no new separate product
blocker.201 coverage rows retained/extended. C5 public Worker-error wording
narrowed to entry/preload/drain rejection with explicit timer-gap owner.
Added retained-contract positive frozen/non-extensible/readonly-constructor
record oracles: native clones all three, candidate rejects; targeted file now
4RED/13PASS (the original frozen-Promise RED plus3cloneable-record REDs).
These additional REDs expose the proposed narrowing; no criterion weakened.
CI unit job also reproduced only original frozen-Promise failure at cdf806fc9
(10636PASS/1FAIL/18SKIP). Both user answers still absent.

## User amendment2026-09-25 supersedes the pending fork

User: “Vitest достаточно; бинарный IPC явно запрещён”; also permits the earlier
opaque-brand ceiling if needed. Native codec eliminates the need for it.
One native clone, then binary scan; no custom Buffer/Promise/globalProxy owner.
Binary37RED→37GREEN; codec73PASS, both-public-sender physicalnonbinary4/4PASS.
Fresh5502 unchangedVitest10runsPASS47.1s. Afterremoval fresh5503 binary/proxy
browser2/2PASS5.7s:35binaryshapes eachdirection, namedNIE/no-dispatch/connected
recovery, singlegetters. Frozenplainrecord/nativePromise tests nowGREEN.
QuickJS object/array hostProxy mirrors explicitly failnativeclone; no VM
expansionrequired bythe amendedVitest-onlyclaim. ADR0467 recordsdecision and
supersession; olderBLOCK reports remainhistorical, notcurrentacceptance.

## Final native exception repair

IndependentFinal @6a2da600c accepted binary scope/removal and found B2: wrapping
DataCloneError also changes a getter-thrown original Error/DOMException. Native
physical bothsendersRED. New unit2RED then18PASS after removing catch. Preserve
platform clone errors; explicit DataCloneError difference in ADR0467/compat.
No name/stack/brand heuristic can distinguish a reused native-generated exception.

Fresh5506 browser3/3PASS6.8s: nativeNodeError/null/nonDOMException versus actual
ChromiumDataCloneError/25/DOMException, bothsenders sevenuncloneables; renamed
Error/reusednativeDOMException getteridentity/once; binary35shapeseachdirection
no-dispatch/connectedrecovery. Physicalparity4/4PASS compares only shared
rejection/getter/traps/channel semantics, not unclaimed error-class equality.

Removed dead metadata target/failure operations (17VMtestsPASS). Main2c9bbd301
readiness fixes merged cleanly; they repair e2e launcher admission. Finalcompiler
asset10022694bytes SHA052e72b146d87f62aba766778b74b1fa8d1d81d915ecd1f84e1c882002ec5e38;
body unchanged after chunkimporthash normalization; exactpin/2MBguard retained.
Fullgate/packed/currentCI and finalverify atf98099bf7 remain required.

Final f98099bf7: `pnpm pr:check`25/25PASS (test:run211.3s,
test:parity76.3s); packed external tarball consumerPASS237.9s. CI36130870229
production, parity, lint and multiplebrowserlanesPASS; remainingjobs live at
this record. Finalindependentverify running againstexactf980.
