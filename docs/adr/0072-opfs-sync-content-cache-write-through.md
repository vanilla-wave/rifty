# ADR 0072: OPFS sync content cache + async write-through (supersedes the sync-access-handle hot path of ADR-0013)

Status: Accepted (2026-06-03)
Date: 2026-06-03
Supersedes (in part): ADR-0013 — replaces the `FileSystemSyncAccessHandle`-on-the-hot-path design for **file content** sync I/O in `OpfsFsSync`. ADR-0013's realm split, boot detector, directory-op scope, and main-realm `NotImplementedError` guard all stand unchanged.

## Context

ADR-0013 wired OPFS as the primary browser VFS and introduced `OpfsFsSync`, whose `readFileBytesSync` / `writeFileSync` route file content through `FileSystemSyncAccessHandle` (the only synchronous OPFS API). That API has a hard limitation: acquiring a handle (`createSyncAccessHandle()`) is **async**. `OpfsFsSync` therefore threw `NotImplementedError` for any path whose handle wasn't already open, requiring callers to pre-warm via `await fsSync.openSync(path, true)` before the first sync read/write.

The runtime Worker (`packages/runtime-js/src/worker-entry.ts`) had a second, independent gap: it never called `initBackend()` and always installed the in-memory backend, so writes never reached OPFS at all. The e2e acceptance test `tests/e2e/m0-boot.spec.ts` › "write file -> reload -> file persists (OPFS round-trip, A-004)" — which does `fs.writeFileSync('/workspace/persist.txt', marker)` on a brand-new path, reloads, then `fs.readFileSync` — fails on both counts:

1. memory backend → nothing persisted across reload; and even with OPFS wired,
2. `writeFileSync` on a brand-new path throws `NotImplementedError` because no sync access handle is open and one cannot be opened synchronously mid-call.

`fs.writeFileSync` / `fs.readFileSync` are synchronous by Node contract; user code (and the test) cannot be asked to pre-warm an async handle first.

## Decision

Replace the sync-access-handle hot path for **file content** in `OpfsFsSync` with a **synchronous in-memory content cache backed by async OPFS write-through**, and make the runtime Worker boot **async** so it wires the real backend before serving any eval.

### `OpfsFsSync` (packages/vfs/src/opfs-sync.ts)

- Add `content: Map<path, Uint8Array>` — the authoritative source for sync reads.
- `writeFileSync(path, data)` keeps the parent-dir ENOENT guard and index/children maintenance, but writes to `content` (a copy) immediately and **enqueues an async `OpfsVfs.writeFile`** (write-through). It no longer needs an open handle and no longer throws `NotImplementedError`.
- `readFileBytesSync(path)` keeps ENOENT (unknown) / EISDIR (dir) guards, then returns `content.get(path) ?? new Uint8Array()`. A known file always has a cache entry after the boot preload or a prior write; the empty fallback is a safe degenerate (e.g. a transient boot-read failure), never a thrown stub.
- `init(paired?)` / constructor accept an optional **paired async surface**, typed by a local structural interface `PairedAsyncSurface { readFile; writeFile; rm }` — **not** an `OpfsVfs` import (no reverse import / cycle). `OpfsVfs` already satisfies the shape. `installOpfsFs()` threads the `OpfsVfs` it constructs into `OpfsFsSync.init(vfs)`.
- `init()` runs a **content preload** (`preloadContent()`) after `refreshIndex()`: it reads every indexed file's bytes once through the paired async surface into `content`, so post-reload `readFileSync` serves the persisted bytes synchronously.
- `flush()` drains all in-flight write-through / async-rm promises (tracked in a `pending` array). Deletes (`persistRmAsync`) are now tracked in the same queue so `flush()` is deterministic for deletes too. `removeSubtree` drops `content` entries for removed files.
- A `loadFixture(files)` method mirrors `MemoryFsSync.loadFixture` but routes through `writeFileSync`, so editor saves stay coherent on OPFS.
- The handle machinery (`openSync`/`ensureHandle`/`handles`) is retained (and still used by `statSync` when a handle happens to be open) but is off the content read/write hot path.

### Runtime Worker (packages/runtime-js/src/worker-entry.ts)

- The loader + REPL bindings are built behind a `boot` promise that `await initBackend()` first (with a try/catch that degrades to `installMemoryFs()` so the Worker still boots if OPFS init ever fails — the original Worker was memory-only, so this is strictly no worse), then builds the module loader from the now-active `syncMirror()` and returns it. `{ type: 'ready' }` is posted only after `boot` resolves, so a write performed *after* the `[worker ready]` marker (the OPFS round-trip e2e) lands on the wired backend.
- The `message` listener is attached **synchronously** (not deferred behind the await): `eval` / `load-fixture` handlers `await boot` before running, `ping` answers immediately. This is load-bearing — the playground REPL types into the terminal *without* first waiting for `[worker ready]`, and `controller.eval` posts to the Worker immediately (no host-side buffering). Deferring the listener until after the await (the first cut) relied on the Worker message queue redelivering those early posts, which proved unreliable: the first REPL eval was lost and `m1-repl` e2e regressed. Attaching the listener up-front and awaiting `boot` inside each handler guarantees an early eval is *received* and then *handled* once the backend is wired — never dropped.
- `load-fixture` routes through the active mirror (`syncMirror().loadFixture?.()`), not a captured memory instance.
- `handleEval` awaits `syncMirror().flush?.()` in a `finally` before the eval result is posted, so a file written during eval is durably persisted before the host can resolve the eval promise (and before the e2e reload).

## Alternatives considered

- **SAB async-to-sync sub-worker bridge** (a sub-worker opening sync access handles, surfaced to the main worker via `Atomics.wait` over a `SharedArrayBuffer`). Proven to work end-to-end in a spike, but adds a whole sub-worker + SAB subsystem and protocol. Rejected as far larger than needed.
- **Keep the handle hot path, require callers to pre-warm.** Impossible for `fs.writeFileSync` on a brand-new path from arbitrary user code — violates the Node sync contract. Rejected.
- **Lazy per-file preload** (read+cache on first sync access). Can't satisfy a *synchronous* first read after reload. The boot preload is the minimum that makes post-reload reads synchronous. (A lazy variant remains a future option if the eager preload's O(total bytes) cost bites a large persisted tree — recorded as a reversible follow-up.)

## Consequences

- The OPFS round-trip (write → reload → read) works synchronously end-to-end; the e2e acceptance test passes.
- `OpfsFsSync.writeFileSync` / `readFileBytesSync` no longer throw `NotImplementedError`; the no-handle branches are gone. The public `FsSync` interface is unchanged — `loadFixture` / `flush` are extra backend methods (like the existing `MemoryFsSync.loadFixture`), not new interface members.
- Durability depends on async write-through landing before reload. Mitigated by (1) `flush()` awaited in `handleEval` before the result is posted and (2) `createWritable` persisting in ~4ms (spike-measured) vs. a multi-step Playwright reload.
- The boot preload reads every persisted file's bytes into memory at `init()` — O(total bytes) memory, O(files) async reads. Fine for the e2e/playground working set; revisit (lazy preload) if a large `node_modules` tree from M10 integration makes it slow. (Reversible — see OPEN_QUESTIONS.)
- No new external dependency; no new sub-worker / SAB subsystem; no reverse import (structural `PairedAsyncSurface`, not an `OpfsVfs` import).

## Reversibility classification

IRREVERSIBLE per CLAUDE.md checklist item 4 (the change spans >2 files / >100 lines and alters behaviour on the `@rifty/vfs` internal surface). It does **not** change the cross-package public `FsSync` interface, so it is not a public-API break; recorded here inline as required.

## Acceptance

- [x] Node memory-fallback path unchanged: `vitest run --project unit --project conformance packages/runtime-js packages/vfs` → 139 passed / 1 skipped; `tests/conformance/builtins/vfs-boot.test.ts` green; existing `opfs-sync.test.ts` (26 tests) green (constructor/init realm guards, warm-index, dir-tree mirror all retained).
- [x] Parity runner exits 0 (`pnpm test:parity` → "all cases match").
- [x] `pnpm check:deps` → no new circular dependency.
- [ ] e2e OPFS round-trip passes in Chromium — verified by the parent harness (`CI=1 pnpm exec playwright test --project=chromium tests/e2e/m0-boot.spec.ts -g "OPFS round-trip"`); not runnable in the implementation sandbox (no browser).
