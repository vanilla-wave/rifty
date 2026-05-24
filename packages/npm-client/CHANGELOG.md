# Changelog

## [Unreleased]

### Added

- Semver matcher (`matchesRange`, `pickBestVersion`) supporting exact, `x`-ranges, caret/tilde, comparator sets.
- `RegistryClient` with pluggable fetcher; `getPackument(name)` and `getTarball(name, version)`.
- gzip + tar unpacker (`extractTarGz(bytes) → Record<path, bytes>`).
- `install(name, range, opts)` end-to-end: resolve → fetch tarball → unpack into `node_modules/<name>/`.
- Lockfile reader/writer (npm v3 shape).
- Shadow-registry override hook (D-005) ahead of resolution.

### Changed

- Built-in override table moved out of `src/overrides.ts` into the new
  `@rifty/shadow-registry` workspace package (ADR 0015). Public API
  (`resolveOverride`, `OverrideMap`) is unchanged.
