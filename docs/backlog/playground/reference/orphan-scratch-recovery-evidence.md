# Orphan Scratch recovery evidence

BASE accepted I4 source71d5837158953c2ac1f3ac53d712162c3ea04cd7;
rechartf76c99ae556618170f80a35390edd8753b28932a changes only records.
No I6 production implementation yet. ADR-0406/0407 compile accepted I6.

## Authorities / material choices

- Goal I6/scenario6 and recorded user choice: preserve/download old orphan,
  open fresh Scratch; no adoption/deletion of only copy. Separate raw user
  transcript is unavailable; unchanged accepted goal is the hand-off authority.
- ADR-0279 owns compact catalog copy/pointer/recovery; existing state owner/FIFO
  is reused. ADR-0402 already bounds native storage. No extra journal/lease.
- Existing editable export omits node_modules/dist; generic export includes them
  but lacks public redaction/bounds. Distinct bounded recovery JSON preserves
  ordinary tree and leaves existing editable ingress unchanged (ADR-0407).
- Existing capture vfs/opfs-preload-failure-empty-bytes is consumed here.
  Independent DEC-2 native evidence selects shared cache-presence read/copy
  refusal (ADR-0406), keeping cache authority, per-file preload and drain.
- Populated-cache repeated-preload freshness is separately measured; no cache
  invalidation/epoch is introduced. Existing coherence finding remains linked.

## Native cold-cache baseline and RED

Original native probes and independent8-case source/copy/cp/rename sweep:
/tmp/rifty-316-orphan-preload-probe and
/tmp/rifty-316-i6-preload-decision-probe. Commands/results/custody details in
orphan-scratch-recovery-pickup.md. Node24.16.0,Chromium148.0.7778.96.
Native getFile refusal is the only injected read boundary. Source remains9bytes;
new/existing destination becomes durable empty with clean flush. Metadata+
preload double failure has size0, disproving size-based authorization.

Transferable native carriers first ran in /tmp/rifty-316-i6-preload-carriers:
5 semantic RED/2 controls GREEN,2.7s; actual source hashes and native results in
source.json/observations.json, raw red.log. Copied only spec/Worker to repository.
Standard browser lane then reran unchanged production:

`RIFTY_PLAYGROUND_PORT=5398 pnpm exec playwright test --config
playwright.browser-unit.config.ts tests/browser-unit/opfs-preload-honesty.spec.ts
--reporter=list`:5 semantic RED/2 GREEN,6.7s.
Raw /tmp/rifty-316-i6-preload-tracked-red.log.
Original source/default/sibling bytes, real empty/healthy controls, target error
ordering, successful preload retry/fresh Worker and native rename custody are
observed; no VFS/owner/package implementation is mocked.

## Representative export sizing

`node --import tsx /tmp/rifty-316-i6-recovery-measurement/run.mts`:exit0,
sourcef76c99ae5,Node24.16.0. Real public producer from original npm lock/archives,
Vite7.3.6/Rollup4.63.1/esbuild0.28.0; standard tar extraction, real native Vite
build and Git index/objects. Full ordinary payload267files/336entries/depth7,
23,601,962 decoded bytes. Largest esbuild.wasm13,918,738B. Existing generic
JSON31,493,921UTF-16units. All6 current numeric archive bounds fit; new recovery
envelope must pass its own acceptance, not borrow a fabricated measurement.
Per-file hashes/base64 readback and exact inputs in
/tmp/rifty-316-i6-recovery-payload-measurement.json; concise method/provenance
/tmp/rifty-316-i6-recovery-payload-measurement.md. Existing editable export drops
NM/dist; its small output is not the capacity basis. No private Tracker size or
larger-package guarantee. Numeric export caps never cap file-by-file retention.

## Further preparation

Real catalog/facade, native public/custody, codec and mandatory packed carriers
are being prepared before Contract+RED. Packed fixture extracts actual producer
payload and captures actual preceding browser Vite build output; fresh recovery
Scratch uses the existing public ms producer/Node oracle. No fake project tree,
registry capability, install trust or browser success is asserted before GREEN.

## Prepared carriers

- Codec13/13 semantic RED at the actual absent exporter; actual real MemoryVFS
  input/name admission, all256 byte/base64 oracle, exact/overflow6 numeric bounds,
  directory/file sets, private claims vs ordinary lookalikes, whole-FS invariance
  and unchanged editable ingress. Types/Biome GREEN. Raw/method:
  /tmp/rifty-316-i6-codec-red-evidence.md and /tmp/rifty-316-i6-codec-red.log.
- Native/public orphan14/14 semantic RED, no hangs: absent actual public list,
  occupied Scratch before new transitions. Native source getFile refusal reaches
  the actual boundary twice; original9bytes stay exact. Prepared8 native kill
  checkpoints: before/after retained copy close, retention catalog pointer close,
  source remove and subsequent fresh catalog pointer close. Quota/fresh-pointer
  failure and retained cold-read/export retry remain mandatory GREEN paths;
  baseline cannot reach them before retention exists. No fake VFS/owner methods.
  /tmp/rifty-316-i6-orphan-browser-carriers.md and
  /tmp/rifty-316-i6-orphan-browser-red-final-14.log. Types/Biome GREEN.
- Initial native seed used a backslash filename; Chromium itself rejected it
  before product code. /tmp/rifty-316-i6-orphan-seed-diagnostic.log; excluded from
  product RED. Native input now uses admitted Unicode/percent names. Real Memory
  VFS separately admits literal backslash; envelope semantics preserve its name.
- Catalog facade uses actual snapshot-only owner, producer/ms bytes and existing
  durable storage-boundary fixture. Initial14-case draft included2 invalid
  MemoryFs read overrides; removed before review because copy bypasses that
  override and native failure belongs at getFile. Remaining12 cases were verified
  byte-identical:8RED/4GREEN, types/Biome GREEN. Native read/export obligations
  unchanged. Historical source/report under
  /tmp/rifty-316-i6-catalog-preparation-14cases.* are harness history only.
  Final carrier/evidence: /tmp/rifty-316-i6-catalog-red.md and .json.
- Catalog preparation also reproduces malformed-journal cleanup: existing
  recovery deletes malformed transaction and unknown retained sentinel, admitting
  owner. ADR-0407 requires preserved/loud uncertainty; no observed baseline is
  silently called already correct. This branch stays in the current I6 repair.
- Final catalog carrier adds real16,777,217-byte patterned MemoryFs input:
  preservation/list must succeed independently of export caps; actual public
  export must reject file-size overflow and leave retained SHA256/bytes and fresh
  Scratch intact. No knobs, overrides or large durable-snapshot fixtures.
  Final13cases=9RED/4GREEN; types/Biome GREEN, actual input/hash setup reaches the
  old occupied-target refusal. Other12 criteria unchanged; final source hash
  aa70bff37e402151302be4601bd9bbdd6d17c9027acdb90f210624c3f35095fa.
- `pnpm test:packed-consumer`:expected installed-public-API RED74.25s after
  actual build/pack/offline install. TS2339 only: missing listRetainedScratch and
  exportRetainedScratch. Raw /tmp/rifty-316-i6-packed-red.log. No browser/producer
  seed execution claimed for this type-stopped run. Source fixture type check
  has only the same two API errors; its dir-kind/BufferSource setup issues were
  corrected before this recorded packed run. Existing mandatory journeys and
  zero-egress assertions remain; added recovery proof is unconditional.

`pnpm docs:check` GREEN: /tmp/rifty-316-i6-prep-docs.log. Production unchanged
from accepted I4; all future recovery behavior still requires Contract+RED.

Preparation total47cases:41semantic RED/6 GREEN; packed API absence is separate.
New tests/fixtures only, with ADR and factual capture updates. No original
product assertion changed. The existing coherence draft gains measured facts,
keeps its unresolved user-action boundary, and is not silently added to I6.

Independent Contract+RED at12893651c reproduced47cases=41RED/6GREEN and found
one ORACLE-1: catalog expected directories omitted the ordinary empty parent
node_modules/ms/node_modules, created above an excluded claim-shaped directory.
Actual real producer/MemoryFS probe proves it exists and isInstallStampPath=false:
/tmp/rifty-316-i6-review-directory-oracle-red.log. Correction adds only that
expected path; payload/file criteria and accepted empty-directory contract stand.
No production change or new user choice. Same reviewer verifies the correction.

During implementation the same reviewer independently confirmed ORACLE-2:
private owner.openProject(named) requires the named catalog ref active; the
fixture had left fresh Scratch active. Exact BASE/current guard bytes match;
real owner/ms probe refuses direct open, then catalog.activate permits existing
provenance with zero snapshot requests and unchanged named bytes. Artifacts
/tmp/rifty-316-i6-review-active-owner.test.ts/.log and
/tmp/rifty-316-i6-review-unactivated-catalog.log. Correction adds only the existing
public activate call before named reopen; no activation guard or behavior changed.

Same reviewer independently confirmed native observer corrections ORACLE-3/4:
actual /@fs/...eddy*.ts script loads are not acquisition API requests; match
configured /npm-registry or /eddy pathname boundaries, keeping zero assertion.
Native first getFileHandle creates raw[] before close; observer now keeps raw
null versus[] and parsedpointer=null only for those unpublished states. Nonempty
malformed JSON remains loud. Two actual Chromium probes PASS5.7s:
/tmp/rifty-316-i6-review-browser-oracles.spec.ts/.config.ts/.log.
Product recovery semantics unchanged. Corrected isolated2cases GREEN5.4s, then
37/37 native integration GREEN25.8s: preload7, orphan14 (all8 kill boundaries
reached), prior I4 thirteen and old I8 three. Raw
/tmp/rifty-316-i6-browser-integrated-final.log; full attribution
/tmp/rifty-316-i6-browser-integrated-verification.md. Initial35/37 run/diagnostics
are observer-failure history, not product defects or waived acceptance.

## Integrated implementation proof

- One OPFS cache-read helper replaces both empty fallbacks; metadata discovery,
  prior cached bytes and native rename/drain policy stand. Native preload7/7
  GREEN4.5s. Independent caller revert checks: read2RED, copy2RED, exact restored
  source2GREEN; /tmp/rifty-316-i6-vfs-revert-check.json and caller logs. First
  scratch matcher selected no tests; .no-tests-history logs are not evidence.
- Catalog13new+321prior=334/334 GREEN; actual owner/package actor, durability
  faults, malformed journal, >16MiB retention/public cap and named recovery.
  /tmp/rifty-316-i6-catalog-implementation-evidence.json. Stored optional absence
  and canonical before/after field order retained; no new state owner.
- Codec13new+119prior=132/132 GREEN; /tmp/rifty-316-i6-codec-implementation.md.
  Actual new envelope over measured Vite tree:267files/69dirs,23,601,962decodedB,
  31,493,944JSON units, every input/decoded SHA256 equal;
  /tmp/rifty-316-i6-actual-recovery-codec-proof.json. Same numeric limits.
- Public/protocol47 tests and prior companion fixture18 GREEN. Strict wire
  records are frozen/owned; existing pending map/FIFO handles read operations.
  Legacy exact facade-key assertion adds only two declared public methods.
  Two existing boundary fixtures gain unused throw-only methods for typing;
  no recovery success is simulated. App fixture25/25 and App types GREEN.
- VFS/control/extraction129passed/1 historical skip;
  /tmp/rifty-316-i6-vfs-extraction-green.log. Whole source closure151→152 exactly
  matches added catalog-records schema/projection module. Ratchets only decrease.
- Native integration37/37 above plus old legacy-receipt before/after-close2/2
  GREEN5.4s, /tmp/rifty-316-i6-legacy-receipt-green.log. Both legacy boundaries
  preserve40 entries and reopen without fetching the unused snapshot again.
- Mandatory `pnpm test:packed-consumer` GREEN88.92s;
  /tmp/rifty-316-i6-packed-green.log. All prior registry Vite/HMR/sqlite and
  strict snapshot/application/namespace journeys retained. New unconditional
  proof seeds actual producer Vite payload plus preceding real browser build,
  preserves/export/reopens full ordinary bytes and runs fresh ms against Node;
  existing zero registry/Eddy checks include the whole recovery journey.

First full pr:check24/25: old App test fixture lacked the new interface methods.
Its only adjustment is two unused throw-only methods; assertions unchanged.
First unit lane hit6 time-outs in3files, all passed its isolated rerun; no test
deadline or product expectation changed. Raw /tmp/rifty-316-i6-pr-check.log.
Final `pnpm pr:check`25/25 GREEN, unit184.9s/parity60.5s:
/tmp/rifty-316-i6-pr-check-final.log.

ADR-0391 exact TypeScript-worker pin follows tested dist at unchanged10,022,664B:
0b8911fb915145165477c4083c8fde67be00cfc3a58abe89a39f33edef318004.
Driver write:false baseline/current graph comparison reproduces prior I4 pin,
matches all40 current outputs to dist, and finds only hash-import worker drift;
normalized compiler/client code, other compiler/WASM pins unchanged. Artifacts
/tmp/rifty-316-i6-pin-reproducer.mjs/.log and /tmp/rifty-316-i6-pin-review.json.
This is driver evidence for independent Final review, not an independent verdict.
