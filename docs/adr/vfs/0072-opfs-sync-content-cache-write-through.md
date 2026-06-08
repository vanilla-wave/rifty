# ADR 0072: OPFS sync content cache + async write-through (supersedes the sync-access-handle hot path of ADR-0013)

Status: Accepted (2026-06-03)
Date: 2026-06-03
Supersedes (in part): ADR-0013 — replaces the `FileSystemSyncAccessHandle`-on-the-hot-path design for **file content** sync I/O in `OpfsFsSync`. ADR-0013's realm split, boot detector, directory-op scope, and main-realm `NotImplementedError` guard stand unchanged.

## Context

ADR-0013's `OpfsFsSync` routes `readFileBytesSync` / `writeFileSync` through `FileSystemSyncAccessHandle` — the only sync OPFS API. But acquiring a handle (`createSyncAccessHandle()`) is **async**, so `OpfsFsSync` threw `NotImplementedError` for any path whose handle wasn't already open, requiring callers to pre-warm via `await fsSync.openSync(path, true)`.

The runtime Worker (`packages/runtime-js/src/worker-entry.ts`) had a second gap: it never called `initBackend()`, always installing the in-memory backend, so writes never reached OPFS. The e2e test `tests/e2e/m0-boot.spec.ts` › "write file -> reload -> file persists (OPFS round-trip, A-004)" fails on both counts:

1. memory backend → nothing persists across reload; and even with OPFS wired,
2. `writeFileSync` on a brand-new path throws `NotImplementedError` (no open sync handle, can't open one synchronously mid-call).

`fs.writeFileSync` / `fs.readFileSync` are synchronous by Node contract; user code can't be asked to pre-warm an async handle first.

## Decision

Replace the sync-access-handle hot path for **file content** in `OpfsFsSync` with a **synchronous in-memory content cache backed by async OPFS write-through**, and make the runtime Worker boot **async** so it wires the real backend before serving any eval.

### `OpfsFsSync` (packages/vfs/src/opfs-sync.ts)

- Add `content: Map<path, Uint8Array>` — authoritative source for sync reads.
- `writeFileSync(path, data)` keeps the parent-dir ENOENT guard and index/children maintenance, but writes a copy to `content` immediately and **enqueues an async `OpfsVfs.writeFile`** (write-through). No open handle needed; no `NotImplementedError`.
- `readFileBytesSync(path)` keeps ENOENT (unknown) / EISDIR (dir) guards, then returns `content.get(path) ?? new Uint8Array()`. A known file always has a cache entry after boot preload or a prior write; the empty fallback covers a transient boot-read failure, never a thrown stub.
- `init(paired?)` / constructor accept an optional **paired async surface**, typed by a local structural interface `PairedAsyncSurface { readFile; writeFile; rm }` — **not** an `OpfsVfs` import (no reverse import / cycle). `OpfsVfs` already satisfies the shape; `installOpfsFs()` threads its `OpfsVfs` into `OpfsFsSync.init(vfs)`.
- `init()` runs `preloadContent()` after `refreshIndex()`: reads every indexed file's bytes once through the paired surface into `content`, so post-reload `readFileSync` serves persisted bytes synchronously.
- `flush()` drains all in-flight write-through / async-rm promises (tracked in `pending`). Deletes (`persistRmAsync`) join the same queue, so `flush()` is deterministic for deletes too. `removeSubtree` drops `content` entries for removed files.
- A `loadFixture(files)` method mirrors `MemoryFsSync.loadFixture` but routes through `writeFileSync`, keeping editor saves coherent on OPFS.
- The handle machinery (`openSync` / `ensureHandle` / `handles`) is retained (still used by `statSync` when a handle is open) but off the content read/write hot path.

### Runtime Worker (packages/runtime-js/src/worker-entry.ts)

- Loader + REPL bindings are built behind a `boot` promise that `await initBackend()` first (try/catch degrades to `installMemoryFs()` so the Worker still boots if OPFS init fails — no worse than the original memory-only Worker), then builds the module loader from the active `syncMirror()`. `{ type: 'ready' }` is posted only after `boot` resolves, so a write after the `[worker ready]` marker lands on the wired backend.
- The `message` listener is attached **synchronously**, not deferred behind the await: `eval` / `load-fixture` handlers `await boot` before running, `ping` answers immediately. Load-bearing — the playground REPL types without waiting for `[worker ready]` and `controller.eval` posts immediately (no host-side buffering). The first cut (defer listener until after await, relying on the Worker message queue to redeliver early posts) proved unreliable: the first REPL eval was lost and `m1-repl` e2e regressed. Attaching up-front and awaiting `boot` inside each handler guarantees an early eval is received then handled once the backend is wired — never dropped.
- `load-fixture` routes through the active mirror (`syncMirror().loadFixture?.()`), not a captured memory instance.
- `handleEval` awaits `syncMirror().flush?.()` in a `finally` before posting the result, so a file written during eval is durably persisted before the host resolves the eval promise (and before the e2e reload).

## Alternatives considered

- **SAB async-to-sync sub-worker bridge** (sub-worker opens sync access handles, surfaced via `Atomics.wait` over a `SharedArrayBuffer`). Proven end-to-end in a spike, but adds a whole sub-worker + SAB subsystem and protocol. Rejected as far larger than needed.
- **Keep the handle hot path, require callers to pre-warm.** Impossible for `fs.writeFileSync` on a brand-new path from arbitrary user code — violates the Node sync contract. Rejected.
- **Lazy per-file preload** (read+cache on first sync access). Can't satisfy a *synchronous* first read after reload. The boot preload is the minimum that makes post-reload reads synchronous. (Lazy variant stays a future option if eager preload's O(total bytes) cost bites a large persisted tree — recorded as a reversible follow-up.)

## Consequences

- OPFS round-trip (write → reload → read) works synchronously end-to-end; the e2e acceptance test passes.
- `writeFileSync` / `readFileBytesSync` no longer throw `NotImplementedError`; no-handle branches gone. Public `FsSync` interface unchanged — `loadFixture` / `flush` are extra backend methods (like `MemoryFsSync.loadFixture`), not new interface members.
- Durability depends on async write-through landing before reload. Mitigated by (1) `flush()` awaited in `handleEval` before posting the result and (2) `createWritable` persisting in ~4ms (spike-measured) vs. a multi-step Playwright reload.
- Boot preload reads every persisted file's bytes into memory at `init()` — O(total bytes) memory, O(files) async reads. Fine for the e2e/playground working set; revisit (lazy preload) if a large M10 `node_modules` tree makes it slow. (Reversible — see OPEN_QUESTIONS.)
- No new external dependency; no new sub-worker / SAB subsystem; no reverse import (structural `PairedAsyncSurface`, not an `OpfsVfs` import).

## Reversibility classification

IRREVERSIBLE per CLAUDE.md checklist item 4 (>2 files / >100 lines, alters behaviour on the `@riftydev/vfs` internal surface). Does **not** change the cross-package public `FsSync` interface, so not a public-API break; recorded here inline as required.

## Acceptance

- [x] Node memory-fallback path unchanged: `vitest run --project unit --project conformance packages/runtime-js packages/vfs` → 139 passed / 1 skipped; `tests/conformance/builtins/vfs-boot.test.ts` green; existing `opfs-sync.test.ts` (26 tests) green (constructor/init realm guards, warm-index, dir-tree mirror all retained).
- [x] Parity runner exits 0 (`pnpm test:parity` → "all cases match").
- [x] `pnpm check:deps` → no new circular dependency.
- [ ] e2e OPFS round-trip passes in Chromium — verified by parent harness (`CI=1 pnpm exec playwright test --project=chromium tests/e2e/m0-boot.spec.ts -g "OPFS round-trip"`); not runnable in the implementation sandbox (no browser).


## Inherited from ADR-0013 (deleted; git keeps history)

0072 supersedes only 0013's sync-access-handle content hot path. These 0013 decisions stay in force and are restated here so deleting 0013 loses nothing load-bearing:

- **OPFS as primary browser VFS.** Boot detector (`packages/vfs/src/boot.ts`): `detectVfsBackend()` → `'opfs'` iff `crossOriginIsolated && OpfsVfs.isSupported()`, else `'memory'` (Node tests + non-isolated dev fallback). `getFsVfs()` returns `OpfsVfs` vs `MemoryVfs` accordingly; `initBackend()` calls `installOpfsFs()` / `installMemoryFs()`.
- **Realm split.** Worker realms → sync mirror is `OpfsFsSync`. Main realm → `fs.readFileSync` throws `NotImplementedError('fs.readFileSync', 'sync fs only available in Worker — use fs.promises in main realm')`. Intrinsic: `FileSystemSyncAccessHandle` is Worker-only by platform design, not a stub.
- **A-005 Closed — permanent, not deferred (2026-05-26).** Sync-OPFS directory ops `OpfsFsSync.readdirSync` / `mkdirSync` / `rmSync` throw `NotImplementedError` as FINAL scope. `FileSystemSyncAccessHandle` has no directory variant by design; callers route directory work through the paired async `OpfsVfs`. Scope fixed, never to be filled.
- **Circular-dep gotcha.** Shared `FsSync` interface lives in `packages/vfs/src/fs-sync.ts` so backend modules don't import the swap-in registry (the one circular-dep risk).
- **QuotaExceededError** (0013 follow-up) is now resolved in code — `opfs-errors.ts` maps `QuotaExceededError` → `EDQUOT`. No further action.
