# ADR 0393: Single-pass honest OPFS preload

Status: Accepted (2026-09-08)
Supersedes in part: ADR-0072's empty-content fallback and runtime memory fallback
for failure while reading an acquired OPFS tree. ADR-0372's unavailable/denied
root memory fallback remains.

## Context

Goal I3/I5 requires honest preload and fewer native lookups. Real Chromium RED:
8 files use root=2/directory=24/fileHandle=8/getFile=16; denied getFile or
Blob.arrayBuffer still boots and read/copy return fabricated empty bytes.
Evidence: docs/backlog/vfs/reference/no-coi-opfs-preload-handles-evidence.md.

## Decision

Build index and eager content from a single native-handle traversal; metadata
and bytes use one freshly obtained File. Share the acquired root between paired
surfaces. OpfsVfs coalesces concurrent initialization with one per-instance
promise, cleared on rejection. No retained native path cache or Proxy wrapper;
raw handles and fresh later reads retain native semantics.

After acquiring root, enumeration/getFile/arrayBuffer failure rejects preload
with OpfsPreloadError retaining cause. Publish neither partial mirror nor ready.
Runtime error settlement must reject waiting requests for this failure, without
memory success. Failure obtaining root keeps the existing visible memory fallback.
Indexed file without cached bytes rejects read/copy with EIO; real zero-length
cached bytes remain valid. Writes retain existing healing behavior.

## Candidates

- Per-file read-error state: honest but adds degraded readiness/activation policy
  and another record of failed paths. Whole-preload rejection uses the existing
  initialization boundary instead.
- Long-lived native handle cache/wrapper: adds invalidation and native receiver
  obligations; unnecessary because the traversal already receives every handle.
- Single native traversal + existing cache: selected; no new byte owner.

Independent DEC-2 decision: /root/preload_decision, 2026-09-08; raw ADR-0072,
ADR-0372, accepted goal and native memory fixture checked. Its follow-up narrows
supersession to preload failure; root-denial rejection was an unsupported expansion.

## Consequences

Eager sync reads, async write-through and native error mapping remain. No atomic
tree snapshot, lazy sync I/O or foreign-owner coherence claim.
