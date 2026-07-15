# Changelog

## [Unreleased]

### Added

- Shared non-empty `VfsMutationIntent` batches and generic
  `VfsMutationGuard`/`guardVfsMutations` contract let host policy fence the
  exact real mutation without owning VFS behavior (ADR-0276).
- `VfsMutationIntent` adds the semantic `{ kind: 'replace'; path }` candidate
  scope for owner-proven content replacement (ADR-0276).

### Changed

- **OPFS persist watchdog (2026-07-13).** `OpfsFsSync.flush()` now reports a
  never-settling write/mkdir/rm/rename as dirty within 30 seconds while the
  uncancellable browser operation remains on the real FIFO tail. Later flushes
  stay bounded; a late success heals the ledger and a late rejection replaces
  the watchdog record with the real failure. Per-operation ledger fences keep
  an older late completion from erasing a newer same-path timeout.

- **PR #115 root-cause round (2026-07-06): async `OpfsVfs` re-joined the
  backend contract.** Non-recursive `mkdir` on an existing dir/file (and
  `mkdir('/')`) is `EEXIST` — the final-segment `create:true` was masking it;
  `stat` now OBSERVES the `utimes` side-table (files fall back to
  `lastModified`, dirs to 0) instead of letting `utimes` succeed with no
  observable effect, and `writeFile`/`rm` invalidate stamps so a rewrite or
  recreate never resurrects an old mtime. Structural kill for the
  sibling-drift axis: new `vfs-async-contract.test.ts` runs one contract
  `describe.each` over MemoryVfs AND OpfsVfs (full fake-OPFS tree), mirroring
  what `fs-sync-strict-paths` does for the sync backends.

- **PR #115 final review path-shape fix (2026-07-06).** Async `OpfsVfs`
  directory-walk failures from `readdir`/`rm`/`stat` now name the requested
  target path, not the ancestor component that failed the OPFS handle walk.
- **PR #115 final review fixes (2026-07-06).** OPFS sync writes now bump
  `mtime` monotonically and `statSync` trusts the sync mirror's cached size
  even when a stale sync access handle is open; `mkdirSync('/existing-file')`
  reports Node's `EEXIST` on both Memory and OPFS sync backends while traversal
  through a file stays `ENOTDIR`; async `OpfsVfs.writeFile` no longer creates
  missing parent directories.
- **Absolute-only path contract (ADR-0199).** `normalizeAbsolute` (and thus every
  `Vfs`/`FsSync` entry point) throws on a relative path instead of silently
  anchoring it at `/` — the silent coercion masked missing cwd resolution in
  callers (the fs-streams wrong-file bug). cwd anchoring lives strictly above
  the VFS. Fix round 2026-07-05: the OPFS surfaces now enforce it too —
  `OpfsVfs` walked raw relative paths via `segments`/`dirname` (implicit
  rooting) and `OpfsFsSync` normalized without asserting; a relative missing
  path could even spin `assertNoFileAncestor` forever (`dirname('foo')` → `'.'`
  → `'.'`…). Guard: `fs-sync-strict-paths.test.ts` relative-rejection suite
  over both backends + the async `OpfsVfs` surface.
- **Backend errors name the TARGET path and distinguish ENOTDIR.** Traversal
  through a file is `ENOTDIR` (never a silent miss→`ENOENT`), `rm force`
  suppresses only `ENOENT`, and `writeFile`/`mkdir`/`rename`/`copyFile` errors
  carry the full target path instead of the parent — identical semantics in
  `MemoryBackend` and `OpfsFsSync` (guard: `fs-sync-strict-paths.test.ts`,
  Node truth: parity case `fs/error-shape-errno-syscall`).
### Fixed (PR #107 round 20)

- **Rename persistence heals destination ancestor failures.** A successful
  rename write to `/dst/file` now clears stale mkdir failures for `/dst` and
  its ancestors, so a durable moved tree is not misreported as torn.

### Fixed (PR #107 round 19)

- **The persist-failure ledger heals ANCESTOR dirs on a descendant persist.** A
  successful write-through (or mkdir) now clears any stale ancestor mkdir
  failure — a persisted descendant proves the whole parent chain exists on disk:
  `OpfsVfs.writeFile` can only succeed once that chain is present, and mkdir
  creates it explicitly. The old entry no longer described a divergence yet
  still made a durable tree look torn and wrongly skipped/revoked its install
  stamp.
- **A rename whose SOURCE is already gone (`NotFoundError`) heals its
  destinations.** The source removal now treats already-gone as a successful
  removal (same rule as `rm`) instead of recording every durably-written
  destination as a bogus `rename` failure.

### Added (PR #107 round 18)

- **`PersistFailureReport.anyFailure(predicate)`** — a FULL-ledger query
  (OpfsFsSync backend). `failures` is only a SAMPLE, so a durability gate that
  scans it can miss a torn-tree path when foreign failures fill the first
  `PERSIST_REPORT_SAMPLE`; `anyFailure` asks the whole ledger.

### Fixed (PR #107 round 15)

- **The persist-failure ledger heals on structural ops.** A durably-removed
  subtree (recursive `rm`, or the source side of a fully-persisted rename)
  clears every ledger entry beneath it, and a rename's destination write heals
  its path — disk and mirror agree, so the old entries no longer describe a
  divergence. Stale entries used to make a durable tree look torn forever,
  wrongly skipping/revoking install stamps.

### Added

- **Persist-failure ledger — `flush()` reports swallowed OPFS failures
  (ADR-0187 Corrected).** `OpfsFsSync` records every failed write-through /
  mkdir / rm / rename persist per path (a later successful persist of the same
  path heals its entry; an `rm` hitting `NotFoundError` counts as success —
  disk already agrees). `flush()` still never rejects but now returns a
  `PersistFailureReport` — `failures` is a sampled view, `total` the full
  count; the ledger itself is uncapped (keyed by path, so bounded by the
  distinct paths written — the same order as the mirror's own index), keeping
  every failure healable so `total` returns to 0 after a quota event. A caller
  that promises durability (the playground install stamp) gates on
  `total === 0` instead of trusting FIFO order across silently-failed ops.

- **Write-through FIFO ordering pinned as a contract (ADR-0187).** `OpfsFsSync`'s
  `enqueuePending` serialization is now load-bearing for the playground's non-blocking install
  stamp ("durable stamp implies durable tree" via queue order, not a blocking flush): a
  RED-on-parallelize test asserts completion order equals call order under inverted per-write
  latencies, and the site carries the contract comment.

### Fixed

- **mkdir missing-parent errors name the TARGET** in `MemoryBackend`,
  `OpfsFsSync` and async `OpfsVfs.mkdir` (was: the missing/failing component —
  the one gap in the "errors name the TARGET path" contract above; review
  2026-07-05 handoff #7).
- **PR #115 review follow-up:** `OpfsVfs.rm(path, { force:true })` now
  suppresses only `ENOENT`; through-file (`ENOTDIR`), permission, quota, and
  browser I/O failures stay loud instead of being reported as success.
  `OpfsFsSync.cpSync('/file/child', dst)` now reports `ENOTDIR` with the
  source path instead of collapsing the traversal failure to `ENOENT`.
  `OpfsFsSync.writeFileSync('/dir', bytes)` now throws `EISDIR` instead of
  mutating the warm index from directory to file and leaving stale descendants.
- **`openReadable` validates its window.** `chunkSize: 0` previously looped the
  pull callback forever (reader hang); a negative `start`/`end` fell into
  `subarray`'s from-the-end semantics. Both are loud `RangeError`s now, in
  `MemoryVfs` and OPFS `chunkedFileStream`.

- **`MemoryBackend.rename` now invalidates cached dirents for both source and
  destination parents.** A move after `readdirSync()` no longer leaves stale
  directory listings in the file manager or sync VFS consumers.
- **`MemoryBackend.writeFile` mtime is now strictly monotonic on overwrite.** Two writes to the same file within one clock tick previously shared the same `Date.now()` mtime; an overwrite now bumps mtime to at least `prev + 1`. Closes a silent-data-loss hole for mtime-trusting stat caches: isomorphic-git's racy-clean index shortcut (`compareStats`) compares mtime only at SECOND granularity but `ino` exactly, so a same-byte-length edit was invisible to `git status`/`diff`. Deterministic guard: `mtime-monotonic.test.ts`. Pairs with the `@riftydev/git` fs-adapter's mtime-derived `ino` (ADR-0167).

### Performance

- **`normalizePath` already-normalized fast-path + internal `dirnameNormalized`/`basenameNormalized` helpers (#10).** An already-normalized ABSOLUTE path now returns from `normalizePath` untouched (no split/stack allocation); relative inputs still take the slow path. Two new INTERNAL helpers (`dirnameNormalized`/`basenameNormalized`) skip the redundant `normalizePath` pass `dirname`/`basename` run, threaded only into provably-normalized call sites (`MemoryBackend.writeFile`/`rm`; `OpfsFsSync` `ensureHandle`/`attachChild`/`detachChild`/`writeFileSync`/`loadFixture`). Byte-identical to the prior `normalizePath`/`dirname`/`basename` across the full edge set (`/a/..`, `/a/.`, `/a//b`, relative, `''`, dotted names, trailing slash) — proven by unit-parity (helper === public fn) + a node-parity case (`cases/path/normalize-fastpath.case.ts`). Helpers stay INTERNAL (NOT exported from `src/index.ts`) so the public `@riftydev/vfs` surface is unchanged; preserves the ADR-0037 normalisation invariant. Behavior-preserving / contract-stable (ADR-0081 rule 5; CHANGELOG-only). Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` + `…-adr-plan-2026-06-06.md` (#10).
- **`OpfsFsSync.writeFileSync` takes ONE shared defensive slice (#3, Q-2026-06-06-319).** The two independent `data.slice()` (content cache + async write-through) collapse to a single shared copy (2N→N copies/write). The retained entry-point slice is the SOLE barrier severing a live mutable caller buffer (and WASI `fd_write`'s in-place reuse, fd.ts:88) from cached content — `readFileBytesSync` returns the cache by reference; the write-through consumer (`OpfsVfs.writeFile`) is read-only, so the two surfaces safely share one copy. Merging is safe; dropping the copy is the regression (OPFS aliasing gate verdict: safe-to-proceed). Pins the invariant with aliasing guards in `opfs-sync.test.ts` (+ a complementary `runtime-wasi/.../fd.test.ts` fd_write reuse guard). Provisional judgment recorded in `OPEN_QUESTIONS.md` (**Q-2026-06-06-319**) with a `// TODO(ADR)` marker at the shared-slice site. Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` + `…-adr-plan-2026-06-06.md` (#3).
- **`readdirSync` caches the sorted dirent list per directory (memory + OPFS backends).** `MemoryBackend.readdirEntries` and `OpfsFsSync.readdirSync` memoise the sorted, kind-resolved dirent array instead of re-sorting + rebuilding per call. The cache invalidates on every create / unlink / rename AND on a child's kind/identity change (e.g. `writeFileSync` over an existing name that flips a dirent's type) — invalidated on every `children.set`/`delete`/`clear` (memory) and on every per-child `index.set` / attach / detach / root-subtree-rm (OPFS), so a stale `dirent.isDirectory()` can never be served. Sort order unchanged (lexicographic — Node parity); returned arrays are frozen. The live async `OpfsVfs.readdir` (real OPFS handle iteration) is deliberately NOT cached (no invalidation channel). Behavior-preserving / contract-stable (ADR-0081 rule 5; CHANGELOG-only). Unit: cache-invalidation tests in `memory.test.ts` + `opfs-sync.test.ts`. Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` + `…-adr-plan-2026-06-06.md`.
### Fixed

- **`OpfsVfs.openReadable` no longer depends on `File.stream()`.** It now serves a
  chunked `ReadableStream` by pulling `File.slice(...).arrayBuffer()` ranges, preserving
  `start`/`end` and `chunkSize` while avoiding the worker/cross-realm stall that forced
  runtime-js `createReadStream` to prefer the sync content cache. The chunking logic is
  extracted to an exported `chunkedFileStream(blob, opts)` helper now covered by unit tests
  (chunk boundaries, half-open `[start, end)` window, end-clamp, empty range) — OPFS itself is
  Node-untestable, but the helper runs head-to-head on a `Blob`. `end` is clamped to the blob
  size (`Math.min`), matching `MemoryVfs`/`SyncMirrorVfs`, so an out-of-range `end` no longer
  enqueues trailing empty chunks. The `Vfs.openReadable` window is documented as half-open
  `[start, end)` (the Node-inclusive `createReadStream` `end` is converted in runtime-js).

- **`OpfsFsSync.flush()` now drains directory-shape persistence, not just file writes/deletes.**
  `mkdirSync` directory creation is tracked in the pending queue, so a flush boundary awaits the
  recursive mkdir persist attempt before reload (best-effort, NOT a durability guarantee — a
  failed persist is still swallowed and reconciles on the next `refreshIndex`, same posture as
  file write-through). `renameSync` also persists moved directory shells, covering
  empty-directory moves that previously only changed the in-memory mirror. Pending OPFS
  side effects are serialized in sync-call order (one global chain — ordering is broader than
  the overlapping-path minimum; revisit if write throughput regresses), and directory rename
  persistence reads uncached indexed files through the paired async surface before removing the
  old subtree. `rmSync('/')` now persists by removing each root child individually — OPFS
  `removeEntry` cannot target the root, so the old single `persistRmAsync('/')` was a silent
  on-disk no-op (PR #21 review fix).
- **`cpSync`/`cpRecursive` copy into the source's own subtree** (`cp -r a a` or `cp -r a a/b`)
  no longer infinite-recurses into a stack overflow — both `MemoryFsSync` and `OpfsFsSync`
  now throw `VfsError('EINVAL')` (the guard `renameSync` already had). Review pass 2026-06-07.

### Added

- **ADR-0083:** `FsSync.statSyncOrNull(path)` — a non-throwing stat returning `null` on a genuine miss (`statSync` stays throwing, Node parity). Implemented in both backends (`MemoryFsSync` via `exists`-gated `stat` over one normalize; `OpfsFsSync` via the warm-index lookup over one normalize). Lets the runtime-js resolver collapse its `existsSync`+`statSync` double-probes to one call. Additive method on the shared `FsSync` interface — precedent ADR-0029/0041. See `packages/runtime-js/CHANGELOG.md` for the consumer-side collapse.
- **ADR-0090:** `FsSync` gains `copyFileSync(src,dst)`, `cpSync(src,dst,{recursive?})`, `renameSync(src,dst)` — `node:fs`-*Sync*-faithful, drawing only on the existing `VfsErrorCode` union (no new codes). `renameSync` **preserves mtime** (memory backend moves the live `Node` ref in O(1); `OpfsFsSync` re-keys `index`/`content`/`times` synchronously and enqueues the async OPFS move via `pending`/`flush`, closing+dropping stale handles). `copyFileSync` stamps dst mtime=now (a copy is a new file). `cpSync` recursive is best-effort fail-fast (Node parity — partial output remains, no rollback). Both backends (`MemoryFsSync`, `OpfsFsSync`) implement all three; adding to the shared `FsSync` interface is an **IRREVERSIBLE** cross-package public-API change — out-of-tree implementors get a `tsc` error until they add the methods. Supersedes the provisional `copyTree`+`rm` rename of Q-2026-06-04-313.
- **ADR-0072:** `OpfsFsSync` content sync I/O is now backed by a synchronous in-memory content cache with async OPFS write-through. `writeFileSync`/`readFileBytesSync` no longer require a pre-opened `FileSystemSyncAccessHandle` and no longer throw `NotImplementedError` (replacing the sync-access-handle hot path of ADR-0013 for file content). `init(paired?)` preloads file bytes from the paired async surface so post-reload reads are synchronous; new `flush()` drains write-through deterministically before a page reload; new `loadFixture()` routes editor saves through `writeFileSync`. `installOpfsFs()` threads the `OpfsVfs` into `OpfsFsSync.init` via a structural `PairedAsyncSurface` type (no reverse import). Public `FsSync` interface unchanged.
- Initial `Vfs` interface (read, write, readdir, mkdir, stat, exists, rm).
- `MemoryVfs` in-memory backend with mkdir-p semantics and recursive deletion.
- Path utilities scoped to VFS (POSIX-style joins/resolves; no Node `path` dependency).
- **ADR-0029:** `FsSync.utimes(path, atimeMs, mtimeMs)` on the interface. `MemoryFsSync` writes through to `MemoryBackend.utimes`; `OpfsFsSync` uses an in-memory atime/mtime side-table (no native `FileSystemSyncAccessHandle` mtime mutation). Throws `VfsError('ENOENT')` for unknown paths.
- **ADR-0041:** `Vfs.utimes(path, atimeMs, mtimeMs): Promise<void>` symmetric with the sync side. `MemoryVfs` delegates to `MemoryBackend.utimes`; `OpfsVfs` keeps its own in-memory side-table (no native mtime mutation through `FileSystemFileHandle`).
- `normalizeAbsolute(p)` path helper — normalises absolute inputs and rejects relative inputs loudly (ADR-0199). Used as the documented entry-point invariant for `Vfs` / `FsSync` implementations.

### Changed

- **Layer hygiene (D-A):** `NotImplementedError` is now defined locally in `errors.ts` instead of imported from `@riftydev/io`. Removed `@riftydev/io` from `dependencies` — vfs is below io in the layer diagram, so the upward edge was a hard-rule violation. Class shape and message format match the io copy verbatim (only identity differs).
- `NotImplementedError` is now re-exported from `@riftydev/vfs` public surface so callers (e.g. the playground sync-mirror adapter) can throw it without reaching for `@riftydev/io` — vfs sits below io in the layer diagram, so this gives downstream layers a layer-correct import path.
- **Normalisation invariant:** `Vfs` and `FsSync` interfaces now document that every public method normalises its `path` argument on entry. `MemoryVfs` and `MemoryFsSync` apply `normalizeAbsolute` at each entry; `MemoryBackend.writeFile`/`rm` switched to `normalizeAbsolute` so relative inputs (`./foo/../bar.txt`) no longer corrupt parent/name slicing. Backends MAY assume normalised input from this interface but should still tolerate external sources.
- `MemoryFsSync.statSync` return type now matches `FsSync.statSync` — `{ isFile, isDirectory, size?, mtime? }` — instead of inferring the wider `MemoryStat` shape with always-present fields. The `MemoryStat` shape is a subtype, so consumers that depended on always-present fields are unaffected at runtime, only the declared surface narrows.
- **ADR-0037 — single sync surface for the runtime.** `FsSync` is now the sole sync VFS contract consumed by the JS module loader and WASI preopens (the runtime-js `SyncVfs` / `MemorySyncVfs` pair is deleted). No source change in this package; documenting the cross-package contract since `MemoryFsSync` + `MemoryBackend` are now the only shared sync backend within a Worker realm — `load-fixture`, `fs.readFileSync`, module resolution, and WASI ops all consult one tree. See `packages/runtime-js/CHANGELOG.md` for the consumer-side change.
- **F6 (2026-05-26 vfs audit) — `MemoryBackend` is private to its wrappers.** `MemoryVfs.backend` and `MemoryFsSync.backend` were `readonly` public fields; they are now held in private slots (`#backend`). The async/sync pairing previously sniffed `instanceof MemoryFsSync` inside `setSyncMirror` to autopair an async view from `impl.backend` — that branch is gone. `setSyncMirror(impl, { async? })` now takes the paired async surface as an explicit option; `installMemoryFs`/`installOpfsFs`/`resetSyncMirror` and the runtime-js worker entry pass it at the call site. Type-level + runtime tests in `memory.test.ts` assert `.backend` no longer exists on the public surface. `createMemoryFs()` remains the canonical factory when both surfaces need to share a backend.
- **ADR-0041 — `FsSync.readdirSync` returns `readonly VfsDirent[]`** (was `readonly string[]`). Symmetric with `Vfs.readdir`. `MemoryFsSync` routes through `MemoryBackend.readdirEntries`; `OpfsFsSync` derives `isFile`/`isDirectory` from each child entry in its in-memory index. Eliminates the N+1 `statSync` per child that the playground sync-mirror adapter and `fs.readdirSync({ withFileTypes })` previously paid. Downstream consumers updated to read `.name` instead of bare strings.

### Fixed

- `MemoryBackend.rm` on a non-empty directory (without `recursive: true`) now raises `VfsError('ENOTEMPTY')` instead of `VfsError('EPERM')` — Node's `fs.rmSync` parity. `VfsErrorCode` gains the `'ENOTEMPTY'` variant. `mapOpfsError` translates browser `InvalidModificationError` to the same code, so OPFS and in-memory backends agree. The WASI `path_remove_directory` workaround that hand-rolled an empty-directory probe is removed (see `packages/runtime-wasi/CHANGELOG.md`).
- `OpfsFsSync` now implements all seven `FsSync` methods. Previously `readdirSync`/`mkdirSync`/`rmSync` threw `NotImplementedError('use OpfsVfs')` — every consumer that asked `syncMirror().mkdirSync` (shell `mkdir`, WASI `path_create_directory`, `fs.ts`) silently broke under the OPFS backend, violating the "backend swap memory↔OPFS without touching callers" promise. Directory-shape ops now read/write an in-memory dir-tree mirror seeded by `walkOpfsTree` at boot; persistence to OPFS is fire-and-forget (mirror is authoritative for sync callers, OPFS catches up best-effort).
