# Changelog

## [Unreleased]

### Added

- Initial `@riftydev/git`: git capability over the VFS (isomorphic-git).
- `vfsToGitFs` adapter: exposes a rifty `Vfs` as isomorphic-git's `fs.promises` API — byte/utf8 round-trips, name-listing `readdir`, synthesised POSIX `stat`/`lstat` (fixed `100644`/`040755` modes, per-path stable `ino`), `ENOENT` on missing paths, and symlink-less loud-throws (`readlink`→`ENOENT`, `symlink`→`EPERM`, `chmod` no-op).
