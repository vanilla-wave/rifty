# Changelog

## [Unreleased]

### Added

- Initial `Vfs` interface (read, write, readdir, mkdir, stat, exists, rm).
- `MemoryVfs` in-memory backend with mkdir-p semantics and recursive deletion.
- Path utilities scoped to VFS (POSIX-style joins/resolves; no Node `path` dependency).
- **ADR-0029:** `FsSync.utimes(path, atimeMs, mtimeMs)` on the interface. `MemoryFsSync` writes through to `MemoryBackend.utimes`; `OpfsFsSync` uses an in-memory atime/mtime side-table (no native `FileSystemSyncAccessHandle` mtime mutation). Throws `VfsError('ENOENT')` for unknown paths.
- `normalizeAbsolute(p)` path helper — normalises and coerces relative inputs to absolute (`./foo/../bar.txt → /bar.txt`). Used as the documented entry-point invariant for `Vfs` / `FsSync` implementations.

### Changed

- **Layer hygiene (D-A):** `NotImplementedError` is now defined locally in `errors.ts` instead of imported from `@rifty/io`. Removed `@rifty/io` from `dependencies` — vfs is below io in the layer diagram, so the upward edge was a hard-rule violation. Class shape and message format match the io copy verbatim (only identity differs).
- `NotImplementedError` is now re-exported from `@rifty/vfs` public surface so callers (e.g. the playground sync-mirror adapter) can throw it without reaching for `@rifty/io` — vfs sits below io in the layer diagram, so this gives downstream layers a layer-correct import path.
- **Normalisation invariant:** `Vfs` and `FsSync` interfaces now document that every public method normalises its `path` argument on entry. `MemoryVfs` and `MemoryFsSync` apply `normalizeAbsolute` at each entry; `MemoryBackend.writeFile`/`rm` switched to `normalizeAbsolute` so relative inputs (`./foo/../bar.txt`) no longer corrupt parent/name slicing. Backends MAY assume normalised input from this interface but should still tolerate external sources.
- `MemoryFsSync.statSync` return type now matches `FsSync.statSync` — `{ isFile, isDirectory, size?, mtime? }` — instead of inferring the wider `MemoryStat` shape with always-present fields. The `MemoryStat` shape is a subtype, so consumers that depended on always-present fields are unaffected at runtime, only the declared surface narrows.
- **ADR-0037 — single sync surface for the runtime.** `FsSync` is now the sole sync VFS contract consumed by the JS module loader and WASI preopens (the runtime-js `SyncVfs` / `MemorySyncVfs` pair is deleted). No source change in this package; documenting the cross-package contract since `MemoryFsSync` + `MemoryBackend` are now the only shared sync backend within a Worker realm — `load-fixture`, `fs.readFileSync`, module resolution, and WASI ops all consult one tree. See `packages/runtime-js/CHANGELOG.md` for the consumer-side change.

### Fixed

- `MemoryBackend.rm` on a non-empty directory (without `recursive: true`) now raises `VfsError('ENOTEMPTY')` instead of `VfsError('EPERM')` — Node's `fs.rmSync` parity. `VfsErrorCode` gains the `'ENOTEMPTY'` variant. `mapOpfsError` translates browser `InvalidModificationError` to the same code, so OPFS and in-memory backends agree. The WASI `path_remove_directory` workaround that hand-rolled an empty-directory probe is removed (see `packages/runtime-wasi/CHANGELOG.md`).
- `OpfsFsSync` now implements all seven `FsSync` methods. Previously `readdirSync`/`mkdirSync`/`rmSync` threw `NotImplementedError('use OpfsVfs')` — every consumer that asked `syncMirror().mkdirSync` (shell `mkdir`, WASI `path_create_directory`, `fs.ts`) silently broke under the OPFS backend, violating the "backend swap memory↔OPFS without touching callers" promise. Directory-shape ops now read/write an in-memory dir-tree mirror seeded by `walkOpfsTree` at boot; persistence to OPFS is fire-and-forget (mirror is authoritative for sync callers, OPFS catches up best-effort).
