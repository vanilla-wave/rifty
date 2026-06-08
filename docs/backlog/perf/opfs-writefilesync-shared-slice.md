---
area: perf
subsystem: vfs
status: active
title: OPFS writeFileSync single shared slice + WASI fd_write aliasing gate
created: 2026-06-08
why: OPFS writeFileSync copies the buffer twice (cache + write-through); 2N->N — but safety disputed by cross-cutting #44 (WASI fd_write in-place mutation); the backlog item is this file
sources: [perf-audit #3 + #44, adr-plan C, ADR-0072 (not superseded)]
---
## Context
opfs-sync.ts:434,438: `data.slice()` for content cache AND again for write-through. Reversible 2N→N decision. Cross-cutting report #44 flags HIGH risk (contradicts vfs-subsystem "low risk"): if WASI fd_write mutates the cache buffer in place via a by-reference readFileBytesSync, sharing is unsafe.
## Options / Next
Decision: take one defensive `data.slice()` shared between content cache (:434) and enqueued write-through (:438). GATE (must record + test): WASI fd_write in-place-mutation aliasing hazard vs by-reference readFileBytesSync (opfs-sync.ts:421 / path.ts:118 / fd.ts:92-97) — verify whether readFileBytesSync returns by reference and whether WASI mutates it; ship with an aliasing regression test (mutate a readFileBytesSync result → cache/in-flight write uncorrupted). Safe variant if aliased: make readFileBytesSync copy first (trades write copy for read copy — only wins write-heavy). Record here; TODO(backlog: perf/opfs-shared-slice) marker at opfs-sync.ts writeFileSync body (~line 434).
## Reversibility
REVERSIBLE — rule5 → record here + TODO(backlog: perf/opfs-shared-slice). Not a supersede of ADR-0072 (one-copy/async-writethrough, not two-distinct-copies). No decision subagent. Gate behind aliasing test + benchmark before merge.
