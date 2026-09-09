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
