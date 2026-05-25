# Changelog

## [Unreleased]

### Added

- Initial `Vfs` interface (read, write, readdir, mkdir, stat, exists, rm).
- `MemoryVfs` in-memory backend with mkdir-p semantics and recursive deletion.
- Path utilities scoped to VFS (POSIX-style joins/resolves; no Node `path` dependency).
- **ADR-0029:** `FsSync.utimes(path, atimeMs, mtimeMs)` on the interface. `MemoryFsSync` writes through to `MemoryBackend.utimes`; `OpfsFsSync` uses an in-memory atime/mtime side-table (no native `FileSystemSyncAccessHandle` mtime mutation). Throws `VfsError('ENOENT')` for unknown paths.
