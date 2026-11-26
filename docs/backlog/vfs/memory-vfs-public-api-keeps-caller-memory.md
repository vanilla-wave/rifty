---
area: vfs
status: draft
title: Should the public MemoryVfs readFile/writeFile copy at the embedder boundary, or keep "the VFS takes ownership"?
created: 2026-11-26
why: `MemoryVfs.writeFile(path, bytes)` keeps the embedder's Uint8Array as the file and `readFile` returns the stored bytes themselves, so an embedder that reuses or mutates either changes the file
sources: [PR-469-external-review]
code: [packages/vfs/src/memory.ts, packages/vfs/src/memory-backend.ts, packages/vfs/src/fs-sync.ts]
---

## Context

PR #469 made the guest `node:fs` copy a view before the store keeps it and documented
`FsSync.writeFileSync` as "data is handed over: a store may keep it" (`MemoryFsSync` keeps,
`OpfsFsSync` copies). The async public surface `MemoryVfs` (`@riftydev/vfs`, used by embedders and
internal paths — npm extraction, snapshot restore, the module loader) has the same shape:
`MemoryBackend.writeFile` stores the given bytes, `readFile` returns `node.data` (code read; not run
from an embedder yet). Internal paths rely on it: no copy on install/restore (PR #469 cost
measurements, `packages/isolate-host` exceljs/pptxgenjs restore min memory unchanged).

## Question

Is "the VFS takes ownership of what it is given and lends what it returns" the declared public
contract (then: write it on `Vfs.writeFile`/`readFile` and in the public docs), or does the public
boundary copy while internal paths keep the no-copy route (then: which entry is the public one)?
Settled by: the embedder API owner; a probe of an embedder mutating a buffer after `writeFile`.

## Decisions

- 2026-11-26 — manager, by the user's delegation (manager thread cf2ae711; asked «MemoryVfs.writeFile держит память встраивающего: копировать или объявить „VFS забирает владение“. Рекомендую объявить», the user: «не очень понял. Если решение не очень серьезное прими сам»): the declared public contract is «the VFS takes ownership of the bytes it is given and lends the bytes it returns»; no copy at the public boundary (internal paths — npm extraction, snapshot restore, the module loader — rely on it). Reversible. Left to do: the contract sentence on `Vfs.writeFile`/`readFile` and in the public docs, and the embedder probe from §Question as its test.

## Challenge

challenge: 2026-11-26 — question capture; no premise critic (README §Challenge)
