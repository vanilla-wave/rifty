---
area: kernel
status: draft
title: Cross-realm sync fs (readFileSync/existsSync/statSync) from a kernel-spawned child Worker into the parent's live VFS
created: 2026-06-13
why: Option A (SAB-tunnel cross-realm fs) LANDED in ADR-0150 P6a (owner serves fs.* on the dispatcher; child reads via readKernelSyncApi → SyncRpcFsSync); residuals only — child_process grandchildren, RPC-path conformance, retire the snapshot workaround.
user_story: As a dev whose forked Worker calls `fs.readFileSync`/`existsSync`/`statSync` on a file the parent just wrote, I want it to see the parent's live VFS, but today the child hits a fresh empty realm-local `syncMirror()` and gets ENOENT unless the playground hand-copies a snapshot.
sources: [ADR-0011, ADR-0072, ROADMAP M6]
code: [packages/vfs/src/sync-mirror.ts, packages/runtime-js/src/builtins/fs.ts, packages/kernel/src/shared-globals.ts, packages/runtime-js/src/builtins/child_process-sync.ts, packages/workbench/src/workers/real-vite-bootstrap.ts]
---

## Context

sync-mirror.ts:109 holds activeSync as a module-level singleton defaulting to an empty MemoryFsSync(); it is realm-local, so a spawned Worker bootstraps a fresh module instance whose syncMirror() is its own empty tree. Every fs.ts *Sync op routes through it, so a child reads/writes an isolated tree. The SAB sync-call seam built for exactly this (readKernelSyncApi/KERNEL_SYNC_CALL_KEY) is consumed only by child_process-sync.ts (execSync); NO fs builtin uses it. Playground masks the gap via publishVfsSnapshot(collectSnapshot(...)). ADR-0011:72 deferred this follow-up; never built. The ADR cites the blocker as 'OpfsFsSync from ADR-0013' but ADR-0013 is a dangling number — the real prerequisite landed as ADR-0072. Independently corroborated in the perf audit reference doc.

## Status — core landed (ADR-0150 P6a, 2026-06-16)

Option A shipped: `installRuntimeJsFsHandlers` registers `fs.*` on the kernel dispatcher (owner serves read+write against its `syncMirror()`); a spawned child's GLOBAL mirror becomes `SyncRpcFsSync` via `installRemoteSyncFs` (`RIFTY_REMOTE_FS=1`) — read+write, chunked under the 1 MiB ring, owner = SSoT. Validated end-to-end (cowsay child reads node_modules over RPC; write-coherence audit). The dangling ADR-0013 citation is moot — ADR-0072 was the real prerequisite and is satisfied.

## Options or Next — residuals

- **child_process / fork grandchildren** don't inherit `RIFTY_REMOTE_FS`, and a child registers no fs.* handlers — so a subprocess spawned BY an in-child CLI reads an empty mirror (silent ENOENT), and the 2-hop grandchild→owner read isn't served. Fix: `child_process-worker.ts` propagates `RIFTY_REMOTE_FS`; the child ALSO `installRuntimeJsFsHandlers(getKernelDispatcher(), syncMirror)` so it FORWARDS fs.* recursively (its `syncMirror` is already a `SyncRpcFsSync` to the owner). Same `waitAsync` caveat one level down.
- **Conformance over the RPC** (parity runs in-realm, never through `SyncRpcClient`): spawn a real child, parent writes → child `readFileSync` returns it, asserting RPC-only invariants — error `code`/`errno`/`syscall`/`path` (path/errno/syscall preservation landed, commit `6110db31`), the `FS_RPC_CHUNK` boundary, the concurrent-grow clamp, readdir/stat JSON shape. Folds into `toolchain-build/worker-realm-conformance-harness` ("fs/OPFS in a real worker").
- **Retire** the playground `publishVfsSnapshot` snapshot-copy once the owner-RPC read path fully replaces it (the page explorer still reads snapshots; the shell/CLI path now reads over RPC).

## Reversibility

REVERSIBLE for the dispatch path (internal seam behind the existing isSabIpcSupported()/KERNEL_SYNC_CALL_KEY gate; in-realm syncMirror stays as fallback). Choosing the backing-store contract (snapshot-copy vs SAB-tunnel vs shared-OPFS) is a design call — if it changes the cross-realm sync-fs contract surface, take an ADR.
