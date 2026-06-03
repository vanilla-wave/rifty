# ADR 0013: OPFS as the primary VFS in browser deploys

Status: Implemented (2026-05-24) — code paths landed; persistence round-trip requires a browser e2e (M11 follow-up)
Date: 2026-05

**Decision (2026-05-26):** Directory ops on the sync OPFS surface (`OpfsFsSync.readdirSync`/`mkdirSync`/`rmSync`) throw `NotImplementedError` permanently — this is the final scope, not a deferred slot. The `FileSystemSyncAccessHandle` platform API has no directory variant by design, so callers route directory work through the paired async `OpfsVfs`. A-005 is therefore **Closed — scope fixed, not deferred**.

## Context

`@riftydev/vfs` ships an `OpfsVfs` implementation but the playground bootstrap never wires it in: `getFsVfs()` always returns `MemoryVfs`. The sync mirror (`setSyncMirror(...)` used by `fs.readFileSync` and WASI) is also memory-backed. Files written through `fs.promises` evaporate on reload; persistent storage — a stated M4 deliverable — is not actually wired.

REVIEW_ACTIONS entries A-004 (OPFS not wired) and A-005 (sync mirror not OPFS-backed) describe the two halves of the gap. `FileSystemSyncAccessHandle`, the only sync OPFS API, is Worker-only — that constraint is intrinsic to the platform.

## Decision

Adopt OPFS as the primary VFS in browser deploys with a per-realm split for sync access.

- Playground bootstrap detects `OpfsVfs.isSupported() && crossOriginIsolated`. When both hold, `getFsVfs()` returns `OpfsVfs`. Otherwise the existing `MemoryVfs` path is used (Node tests, non-isolated dev fallback).
- In worker realms, the sync mirror is `OpfsFsSync` (new module under `packages/vfs/src/`), which wraps `FileSystemSyncAccessHandle` and exposes the same `FsSync` interface as `MemoryFsSync`.
- Main-realm sync calls keep throwing `NotImplementedError('fs.readFileSync', 'sync fs only available in Worker — use fs.promises in main realm')`. This is intrinsic, not a stub.
- The async OPFS hookup in playground bootstrap is small and lands as a partial fix outside this ADR. `OpfsFsSync` itself is the deferred piece.

## Consequences

- Persistent storage works for the first time: edits survive page reload.
- The sync/async asymmetry is documented and load-bearing rather than accidental.
- Negative: tests must distinguish realm (Worker vs main) when exercising sync APIs against the OPFS backend.
- Negative: OPFS quota and eviction behavior become observable failure modes; need a `QuotaExceededError` path in `OpfsVfs.write`.
- Follow-up: `OpfsFsSync` implementation in M11, alongside the shared-backend wiring from ADR 0014.

## Acceptance criteria for the deferred implementation

- [~] `OpfsFsSync` passes the same conformance suite as `MemoryFsSync` — **partial**: file ops (`existsSync`, `readFileBytesSync`, `writeFileSync`, `statSync`) implemented via `FileSystemSyncAccessHandle`; directory ops (`readdirSync`, `mkdirSync`, `rmSync`) throw `NotImplementedError('OpfsFsSync.<method>', 'directory ops require an async bootstrap; use OpfsVfs for those')` because the sync API has no directory variant — callers drive those through the paired `OpfsVfs` instead.
- [ ] e2e: write `/workspace/foo.txt` from the playground, `page.reload()`, read the file back, assert content unchanged — **deferred to M11 follow-up** (Playwright + Worker harness not yet wired).
- [x] Main-realm `fs.readFileSync` throws `NotImplementedError` with the documented message under both `MemoryVfs` and `OpfsVfs` deployments — `OpfsFsSync` constructor refuses to instantiate outside a Worker realm with `NotImplementedError('OpfsFsSync', 'sync OPFS only available inside a Web Worker realm')`.
- [x] No regression on the in-memory test path used by Node-side unit tests (`MemoryFsSync` continues to pass) — 280 tests pass after the change (was 275; +7 from the new boot-detector and `OpfsFsSync` realm-gate unit tests).

## Implementation notes (2026-05-24)

- New module `packages/vfs/src/opfs-sync.ts` — `OpfsFsSync`, with `isSupported()` and `init()` realm gates.
- Boot detector `packages/vfs/src/boot.ts` — `detectVfsBackend()` returns `'opfs'` iff `crossOriginIsolated && OpfsVfs.isSupported()`, else `'memory'`. `initBackend()` calls `installOpfsFs()` or `installMemoryFs()`.
- `installOpfsFs()` in `sync-mirror.ts` wires both surfaces (`OpfsVfs` async + `OpfsFsSync` sync) in one call.
- Shared `FsSync` interface lifted to `packages/vfs/src/fs-sync.ts` so backend modules don't import the swap-in registry (was the only circular-dep risk).
- Sync access handles are lazily acquired and memoised per absolute path. Callers that need to read a brand-new file from the sync side must first pre-warm with `await fsSync.openSync(path, true)` or write through the paired `OpfsVfs.writeFile`.
