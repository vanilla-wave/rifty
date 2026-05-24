# Changelog

## [Unreleased]

### Added

- Initial `Vfs` interface (read, write, readdir, mkdir, stat, exists, rm).
- `MemoryVfs` in-memory backend with mkdir-p semantics and recursive deletion.
- Path utilities scoped to VFS (POSIX-style joins/resolves; no Node `path` dependency).
