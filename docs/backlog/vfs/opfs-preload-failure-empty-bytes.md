---
area: vfs
status: draft
title: Failed OPFS preload silently becomes empty file bytes
created: 2026-09-06
why: A persisted file whose preload rejects remains indexed but sync reads return empty bytes, which recovery can propagate.
code:
  - packages/vfs/src/opfs-sync.ts
sources:
  - docs/backlog/terminal/reference/review-2026-06-07.md
---

## Context

Static finding, not a fault reproduced in this session. OpfsFsSync.preloadContent
catches each read failure; readFileBytesSync then returns a new empty Uint8Array
for that indexed uncached file. The no-COI install recovery walk reads that API,
so a later memory recovery can inherit empty bytes. User path: reopen OPFS with
an unreadable persisted file, install a package, restart into memory.

This is a storage-read correctness boundary, independent of redundant snapshot
copying. Scope/impact remains unmeasured: inject an allowed OPFS read rejection
through the real paired surface and prove the post-boot read and copy outcomes
before choosing a repair. Never call an empty byte fallback safe.

Dedup: terminal/reference/review-2026-06-07.md already noted cold-cache
copyFileSync empty bytes, but has no actionable item. vfs/opfs-lazy-content-preload
owns eager-preload cost, not failed-read honesty. ADR declined concepts have no
matching storage-read decision. Capture both sync read and copy siblings here.

## Question

Which honest outcome can preserve synchronous reads when a boot preload fails:
reject initialization, or retain an explicit per-file failure until a successful
write/read establishes bytes? Resolve against the OPFS boundary model and
ADR-0072 before pickup; no silent empty success.

## Challenge

challenge: 2026-09-06 — clear
