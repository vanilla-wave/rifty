# ADR 0406: Refuse unavailable OPFS cache bytes

Status: Accepted
Date: 2026-09
Supersedes (in part): ADR-0072 — empty success for indexed files without cached bytes.

## Context

I6 retention cannot copy fabricated bytes. Real native OPFS getFile refusal at
cold preload leaves a persisted9-byte file indexed but uncached; read/copy return
empty and copy overwrites a real nonempty destination with empty bytes. Metadata
plus preload refusal also reports size0; size checks cannot prove content.
Independent DEC-2 evidence: docs/backlog/playground/reference/orphan-scratch-recovery-pickup.md.

## Decision

- Existing content Map owns availability. A cached Uint8Array, including length0,
  is content; an indexed file without one raises VfsError EIO at its logical path.
  This describes unavailable cache bytes, not a historical native error code.
- One cache-read helper serves readFileBytesSync and copyFileSync; cp inherits it.
  Keep ENOENT/ENOTDIR/EISDIR and destination-validation order. Refused copies
  enqueue no target write; recursive cp retains its existing partial-output rule.
- Keep per-file best-effort preload and index discovery, successful retry/write,
  paired surfaces and write-through/drain semantics. No read failure enters the
  persist ledger; a clean flush never proves that source bytes were acquired.
- Keep uncached rename's real async read/write before source removal. Its missing
  destination cache stays unavailable until content is established. Do not fill
  it from an older async rename task over a newer authoritative sync write.
- No new error Map, global readiness barrier, epoch, native sync read-through,
  public option or persistent metadata. Namespace addressing remains ADR-0402.

## Alternatives

- Existing Map presence and shared read/copy chokepoint: selected; native empty
  and healthy controls prove a per-file distinction suffices.
- Whole-init failure: blocks unrelated cached files and changes backend fallback.
- Catalog-only persisted-copy wrapper: leaves demonstrated generic read/copy
  corruption and inherited backup/export consumers alive.
- Original-error cache union or separate ledger: extra lifetime/state machinery;
  EIO already reports the unavailable-content fact honestly.

## Retained authorities

Only ADR-0072's missing-content empty fallback is overturned. Its cache authority,
preload/write-through, pairing and lifecycle remain. ADR-0090 copy/rename ordering
and ADR-0358/0359 durability remain. Repeated preload with prior real cached bytes
is a separate measured freshness/coherence case; no cache invalidation or live
refresh guarantee is introduced. See vfs/opfs-sync-cross-realm-mirror-coherence.
