# ADR 0425: Persist Workbench trees as validated OPFS segments

Status: Accepted
Date: 2026-09-12

## Context

Delivery: PR #299; evidence `docs/backlog/vfs/reference/replica-public-scale-evidence.md`. T has 15,568
files / 73,637,414 bytes. Current native per-file median: drain 10.320 s,
fresh-process offline preload 4.465 s; target ≤2 s each. Independent DEC-2:
`/root/replica_decision`; evidence and mechanism inventory:
`docs/backlog/vfs/reference/segmented-replica-pickup.md`.

## Decision

1. Retain `OpfsFsSync` as the sync tree and durability owner. Add internal
   `installOpfsFs(root, {layout: 'replica'})`; default standalone installation
   remains per-file. Workbench owner and configured no-COI storage select the
   replica at this existing composition seam, using one captured namespace root.
2. Persist immutable binary segments plus one atomic HEAD containing their
   ordered content digests. Each segment authenticates its metadata and bytes;
   records carry exact canonical logical path, kind, timestamps and content
   digest/range. Deletions are tombstones. Unsupported future kinds/mode/link
   encodings reject; no guest overlay or new public filesystem semantics.
3. Logical mutation capture precedes native admission. The existing drain
   scheduler has one batch execution mode: preserve operation identities,
   registration order, progress watermarks, reporting timeouts and real-settle
   fences; one physical commit at a time. A batch failure affects every exact
   logical operation/path it carries. The existing uncapped sequence-aware
   failure ledger remains the only ledger. Per-file mode retains its lanes,
   ancestor fences and native-directory cache; replica mode needs none of them.
4. Write and close the complete segment before replacing HEAD through native
   `createWritable`/`close`. HEAD is the only storage commit point. A killed
   append exposes the old or new complete tree, never a committed partial batch.
   Replay authenticates every referenced segment and validates the whole logical
   tree before publishing its eager index/content. Unreferenced segments cannot
   become logical state. Native read failures remain loud acquired-state errors;
   deterministic invalid replica state takes explicit cold restoration, with
   a storage-layout diagnosis and no trusted old claims.
5. The paired async read surface reads fresh committed native bytes using the
   authenticated committed path/range/digest index. It never substitutes live
   cache bytes for storage proof or installer equality. Async mutations enter
   the same sync owner, then join its durability boundary. Metadata-only utimes
   persists too. Stamp trust remains a separate post-fence operation; saved
   replay does not wait for installation certification (ADR-0415/0417).
6. Compact by re-emitting a captured immutable live front through the same base
   writer, at a scheduler watermark. Trigger: appended bytes reach the base
   size (minimum 4 MiB), or 64 referenced segments. Later mutations follow that
   capture. Close the replacement HEAD before deleting superseded segments.
   Failed append/compaction retains the prior HEAD and exact ledger failures;
   quota repair permits a later successful persist. Cleanup cannot delete data
   reachable from HEAD; orphan reclamation does not certify logical durability.
7. Acquire a lifetime native exclusive SyncAccessHandle on a separate replica
   guard file before replay. Contention rejects under preferred too. This is
   physical single-writer exclusion for direct/configured SDK consumers, not a
   second Workbench lease. Keep the origin-wide Workbench UI lease unchanged.
   Never release the guard on a reporting timeout while native publication/GC
   can still settle; close joins real settlement, Worker death releases it.
8. The store moves from `/.rifty/workbench/v1` to `v2` under the selected root.
   Never hydrate legacy per-file project bytes. Existing definition materialization
   recreates projects; the Playground catalog starts empty. Report the legacy
   layout explicitly through storage-layout health. Preserve v1 native bytes;
   no migration or export prompt. Loss includes source edits, installed trees,
   cloned repositories and Git history absent from a definition. This is the
   user's 2026-09-01 breaking-change decision, including rejection of ADR-0165's
   available migration-reuse route. Public persistence defaults stay unchanged.

## Alternatives and mechanism inventory

- Existing OpfsFsSync + physical replica: selected. Reuses index/content,
  FsSync behavior, ledger, scheduler reporting/settle and installer cleanliness.
- New MemoryBackend-based ReplicaFsSync: rejected. Requires a new mutation
  observer, transferred durability owner and changed concrete consumers;
  MemoryBackend's input-buffer ownership differs from OpfsFsSync's copy barrier.
- Per-file + lazy/indexed hydration: measured and rejected in the goal's
  reference benchmarks; the file-open floor misses the budget and lazy sync I/O
  contradicts eager all-or-error preload.
- Snapshot reapplication instead of persisted node_modules: user rejected route
  R. No new provenance truth or network dependency on saved reopen.

Existing owners: OpfsFsSync ledger; OpfsDrainScheduler ordering; install claim
and stamp authority; OwnerVfsAppliedJournal page publication; project catalog
migration receipts; Workbench origin lease. None can arbitrate native HEAD for
an independently booted SDK Worker. Native exclusive guard supplies that one
missing physical constraint; no additional epoch, receipt or publication log.
A+B are one agent-owned unit: omit the temporary per-file delta substrate.

## Narrow supersessions

Only replica mode changes these clauses; remaining decisions stay active:

- ADR-0358 per-file parallel admission/directory fencing/cache → batched native
  execution; logical ordering, full stamp fence, ledger and reporting/settle stay.
- ADR-0072 direct paired OpfsVfs write-through/per-file hydration → commit/replay;
  eager memory-backed sync semantics and flush lifecycle stay.
- ADR-0393 and ADR-0411 native-tree traversal → validated replay; no partial ready
  or silent memory fallback on acquired-state I/O failure.
- ADR-0402 Decision 2 concrete pair/no-new-backend clause → replica installation;
  Decision 6's no namespace-keyed Workbench lease remains: native guard protects
  the physical replica, while the existing origin lease still protects Workbench.
- ADR-0392 per-file native equality lookup → committed native record bytes;
  cleanliness recheck and ordinary repair on unknown state remain.
- ADR-0419 configured no-COI installation carrier → same replica mode; public
  storage config, namespace capture and startup policy stay.
- ADR-0029 memory-only timestamps → durable replica metadata.

## Native evidence

Chromium 148.0.7778.96: a second Worker receives NoModificationAllowedError;
termination releases the guard; HEAD is old before close and after a pre-close
kill, new after close. Native guarantees:
[exclusive handle](https://fs.spec.whatwg.org/#api-filesystemfilehandle-createsyncaccesshandle),
[atomic writable publication](https://fs.spec.whatwg.org/#api-filesystemfilehandle-createwritable).
Product fault and performance carriers accompany the implementation; this native
probe alone does not certify the replica.

Replica batches capture final affected images/tombstones from the live front
at admission; intermediate applied writes need no second queued byte mirror.
The old native prewarm/external-refresh controls have no per-file substrate in
replica mode and throw named NotImplementedError; no production caller uses
them. Ordinary FsSync operations and default per-file controls retain behavior.
