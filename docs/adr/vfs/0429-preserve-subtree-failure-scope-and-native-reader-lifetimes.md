# ADR-0429: Preserve subtree failure scope and native reader lifetimes

- Status: Accepted
- Date: 2026-09-13
- Area: vfs

## Context

Final review of ADR-0425 found two native failures. Failed recursive rm followed
by mkdir/child write reports clean while removed descendants return on replay;
per-file mode has the same defect. Compaction also deletes segments still used
by paired readFile/stat/readdir, causing ENOENT on an unchanged file.

## Decision

The existing failure ledger retains the newest unproven subtree sequence at
its path, even when a later entry failure replaces the displayed report.
Directory existence cannot clear that uncertainty. File replacement, recursive
removal and replica base publication prove their full scope. Older successful
subtree operations discharge their own uncertainty while preserving newer
failure reports; subsequent entry success can then heal those reports.
No retry queue or second ledger; an incomplete subtree stays visibly dirty
until genuinely repaired.

The replica publisher tracks settlement of admitted native readers. At base
publication it captures the old readers, swaps committed metadata, then waits
for those readers before reclaiming old segments. New reads use the new map;
readdir retains its captured map across await. readFile protection includes
metadata, content and checksum work. closeAll waits for admitted reads as well
as the existing real mutation fence before releasing the native guard.
No new scheduler or writer. GC remains inside the existing commit/guard lifetime.

## Class sweep and proof

- Failure scope: record/overwrite, exact-path healing, ancestor healing, recursive
  removal, rename destination directories/files, replica images/base; both modes.
  Six native RED cases cover rm, failed mkdir and rename; two late-rm cases
  already GREEN protect causal healing after reporting timeout.
- Reclamation: only replica-store removes segment files. All three nativeEntry
  callers and readFile's post-metadata content read share one reader fence.
  Existing drain/preload state has no reader retirement authority to reuse.
  Continuous read/stat/readdir + writes and four held-native cuts are RED;
  per-file reference is GREEN. Reclamation still runs after reader completion.
- Retrying moving native paths adds possible starvation; skipping reclamation
  indefinitely retains growing garbage. Neither is needed with one settlement set.
