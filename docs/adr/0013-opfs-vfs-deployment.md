# ADR 0013: OPFS as the primary VFS in browser deploys

Status: Implemented (2026-05-24) — code paths landed; persistence round-trip requires a browser e2e (M11 follow-up)
Date: 2026-05

**Decision (2026-05-26):** Directory ops on the sync OPFS surface (`OpfsFsSync.readdirSync`/`mkdirSync`/`rmSync`) throw `NotImplementedError` permanently — final scope, not deferred. `FileSystemSyncAccessHandle` has no directory variant by design, so callers route directory work through the paired async `OpfsVfs`. **A-005 is Closed — scope fixed, not deferred.**

## Context

`@riftydev/vfs` ships `OpfsVfs`, but playground bootstrap never wires it: `getFsVfs()` always returns `MemoryVfs`, and the sync mirror (`setSyncMirror(...)`, used by `fs.readFileSync`/WASI) is memory-backed. Files written via `fs.promises` evaporate on reload — persistent storage (an M4 deliverable) is not actually wired.

REVIEW_ACTIONS A-004 (OPFS not wired) and A-005 (sync mirror not OPFS-backed) cover the two halves. `FileSystemSyncAccessHandle`, the only sync OPFS API, is Worker-only — intrinsic to the platform.

## Decision

Adopt OPFS as the primary browser-deploy VFS, with a per-realm split for sync access.

- Bootstrap detects `OpfsVfs.isSupported() && crossOriginIsolated`. When both hold, `getFsVfs()` returns `OpfsVfs`; otherwise `MemoryVfs` (Node tests, non-isolated dev fallback).
- In worker realms, the sync mirror is `OpfsFsSync` (new module under `packages/vfs/src/`), wrapping `FileSystemSyncAccessHandle` behind the same `FsSync` interface as `MemoryFsSync`.
- Main-realm sync calls keep throwing `NotImplementedError('fs.readFileSync', 'sync fs only available in Worker — use fs.promises in main realm')`. Intrinsic, not a stub.
- The async OPFS hookup is small and lands as a partial fix outside this ADR; `OpfsFsSync` is the deferred piece.

## Consequences

- Persistent storage works for the first time: edits survive reload.
- The sync/async asymmetry is now documented and load-bearing, not accidental.
- Negative: tests must distinguish realm (Worker vs main) when exercising sync APIs against OPFS.
- Negative: OPFS quota/eviction become observable failure modes; need a `QuotaExceededError` path in `OpfsVfs.write`.
- Follow-up: `OpfsFsSync` implementation in M11, alongside the shared-backend wiring from ADR 0014.

## Acceptance criteria for the deferred implementation

- [~] `OpfsFsSync` passes the same conformance suite as `MemoryFsSync` — **partial**: file ops (`existsSync`, `readFileBytesSync`, `writeFileSync`, `statSync`) implemented via `FileSystemSyncAccessHandle`; directory ops (`readdirSync`, `mkdirSync`, `rmSync`) throw `NotImplementedError('OpfsFsSync.<method>', 'directory ops require an async bootstrap; use OpfsVfs for those')` (sync API has no directory variant) — callers drive those through the paired `OpfsVfs`.
- [ ] e2e: write `/workspace/foo.txt` from playground, `page.reload()`, read back, assert content unchanged — **deferred to M11 follow-up** (Playwright + Worker harness not yet wired).
- [x] Main-realm `fs.readFileSync` throws `NotImplementedError` with the documented message under both `MemoryVfs` and `OpfsVfs` — `OpfsFsSync` constructor refuses to instantiate outside a Worker realm with `NotImplementedError('OpfsFsSync', 'sync OPFS only available inside a Web Worker realm')`.
- [x] No regression on the in-memory Node-test path (`MemoryFsSync` still passes) — 280 tests pass (was 275; +7 from new boot-detector and `OpfsFsSync` realm-gate unit tests).

## Implementation notes (2026-05-24)

- New module `packages/vfs/src/opfs-sync.ts` — `OpfsFsSync`, with `isSupported()` and `init()` realm gates.
- Boot detector `packages/vfs/src/boot.ts` — `detectVfsBackend()` returns `'opfs'` iff `crossOriginIsolated && OpfsVfs.isSupported()`, else `'memory'`. `initBackend()` calls `installOpfsFs()` or `installMemoryFs()`.
- `installOpfsFs()` in `sync-mirror.ts` wires both surfaces (`OpfsVfs` async + `OpfsFsSync` sync) in one call.
- Shared `FsSync` interface lifted to `packages/vfs/src/fs-sync.ts` so backend modules don't import the swap-in registry (the only circular-dep risk).
- Sync access handles are lazily acquired and memoised per absolute path. To read a brand-new file from the sync side, callers must first pre-warm with `await fsSync.openSync(path, true)` or write through `OpfsVfs.writeFile`.
