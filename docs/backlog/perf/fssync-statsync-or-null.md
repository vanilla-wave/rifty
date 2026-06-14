---
area: perf
subsystem: vfs
status: active
title: ADR-0085 — FsSync.statSyncOrNull non-throwing stat to collapse existsSync+statSync double-probe
created: 2026-06-08
why: resolver does existsSync THEN statSync at 7 sites — two normalize + two lookups per logical "is this a file?"; new cross-package FsSync method, write-before-code
user_story: As a dev whose `require`/`import` resolves through deep node_modules, I want module lookup to feel fast, but today the resolver does `existsSync` THEN `statSync` at 7 sites — two normalize + two VFS lookups per "is this a file?" — and no non-throwing `statSyncOrNull` exists to collapse them
sources: [perf-audit #11, adr-plan A/ADR-0085, ADR-0029, ADR-0041, ADR-0037]
---
## Context
resolver.ts double-probe sites 94,264,281,303,318,424,620 (292/355 are bare existsSync, excluded → 7). Governs cross-package FsSync interface (vfs/src/fs-sync.ts), implemented in MemoryFsSync + OpfsFsSync, consumed by runtime-js resolver. rule1 (cross-package public API); ADR-0037 "future evolutions land in FsSync only".
## Options / Next
Add `statSyncOrNull(path): {isFile;isDirectory;size?;mtime?} | null` (null-on-any-miss, never throws); statSync stays throwing (Node parity). Both backends implement identically. Collapse the 7 double-probe sites. Mirror existing statSync tests incl. OPFS live-handle size.
## Reversibility
IRREVERSIBLE — rule1 new method on cross-package FsSync. ADR-0037 invites additive FsSync (not superseded). No decision subagent.
