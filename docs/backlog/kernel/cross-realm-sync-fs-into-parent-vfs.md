---
area: kernel
status: active
title: Cross-realm sync fs (readFileSync/existsSync/statSync) from a kernel-spawned child Worker into the parent's live VFS
created: 2026-06-13
why: A kernel-spawned child Worker's fs.*Sync hit a realm-local, freshly-empty syncMirror() — never the parent's MemoryVfs — so a child cannot read files the parent created; it only works in prod because the playground hand-copies VFS snapshots.
sources: [ADR-0011, ADR-0072, ROADMAP M6]
code: [packages/vfs/src/sync-mirror.ts, packages/runtime-js/src/builtins/fs.ts, packages/kernel/src/shared-globals.ts, packages/runtime-js/src/builtins/child_process-sync.ts, apps/playground/src/workers/real-vite-bootstrap.ts]
---

## Context

sync-mirror.ts:109 holds activeSync as a module-level singleton defaulting to an empty MemoryFsSync(); it is realm-local, so a spawned Worker bootstraps a fresh module instance whose syncMirror() is its own empty tree. Every fs.ts *Sync op routes through it, so a child reads/writes an isolated tree. The SAB sync-call seam built for exactly this (readKernelSyncApi/KERNEL_SYNC_CALL_KEY) is consumed only by child_process-sync.ts (execSync); NO fs builtin uses it. Playground masks the gap via publishVfsSnapshot(collectSnapshot(...)). ADR-0011:72 deferred this follow-up; never built. The ADR cites the blocker as 'OpfsFsSync from ADR-0013' but ADR-0013 is a dangling number — the real prerequisite landed as ADR-0072. Independently corroborated in the perf audit reference doc.

## Options or Next

Option A (SAB-tunnel, matches execSync): add fs-sync handlers to the kernel SyncRpcDispatcher (parent serves readFile/exists/stat/readdir against the parent syncMirror) and route a child's fs.*Sync through readKernelSyncApi().call(...) when KERNEL_SYNC_CALL_KEY is present. Option B: install OpfsFsSync as the child's syncMirror so child and parent share one OPFS backend. Failing parity/conformance first: spawn a kernel Worker, parent writes a file, child readFileSync returns it (currently ENOENT without a snapshot). Retire the playground publishVfsSnapshot workaround once real cross-realm reads land; supersede the dangling ADR-0013 citation if the contract surface changes.

## Reversibility

REVERSIBLE for the dispatch path (internal seam behind the existing isSabIpcSupported()/KERNEL_SYNC_CALL_KEY gate; in-realm syncMirror stays as fallback). Choosing the backing-store contract (snapshot-copy vs SAB-tunnel vs shared-OPFS) is a design call — if it changes the cross-realm sync-fs contract surface, take an ADR.
