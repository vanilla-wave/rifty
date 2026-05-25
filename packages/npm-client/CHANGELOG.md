# Changelog

## [Unreleased]

### Added

- Semver matcher (`matchesRange`, `pickBestVersion`) supporting exact, `x`-ranges, caret/tilde, comparator sets.
- `RegistryClient` with pluggable fetcher; `getPackument(name)` and `getTarball(name, version)`.
- gzip + tar unpacker (`extractTarGz(bytes) → Record<path, bytes>`).
- `install(name, range, opts)` end-to-end: resolve → fetch tarball → unpack into `node_modules/<name>/`.
- Lockfile reader/writer (npm v3 shape).
- Shadow-registry override hook (D-005) ahead of resolution.
- `getRegistryBaseUrl()` factory: single source of truth for the registry URL,
  reads `globalThis.__RIFTY_REGISTRY_URL__` (playground bootstrap),
  `globalThis.import.meta.env.RIFTY_REGISTRY_URL` (Vite build env),
  `process.env.REGISTRY_BASE_URL` (Node/test harness), falls back to
  `/npm-registry`. Closes the D-004 / ADR-0028 hardcode.
- Peer-dependency check: after resolve, every package's `peerDependencies`
  is matched against the installed set; missing peers are warned via
  `console.warn` (one line per missing peer). Range checking is left for the
  full peer-resolution milestone.
- Optional-dependency support: `optionalDependencies` entries are attempted
  during resolve; failures are warned and skipped instead of aborting.
- Tar unpacker: GNU long-name (`L`) and long-linkname (`K`) extension blocks
  are now decoded. Symlink entries (typeflag `'2'`) throw
  `NotImplementedError('npm-client.tar.symlink')` instead of being silently
  dropped, so the failing package is visible in the trace.
- Proper pre-release version comparison per semver §11.4 (numeric identifiers
  compare numerically, non-numeric lexicographically, numeric < non-numeric,
  shorter set < longer set). Fixes `1.0.0-alpha.2 < 1.0.0-alpha.10`.

### Changed

- Built-in override table moved out of `src/overrides.ts` into the new
  `@rifty/shadow-registry` workspace package (ADR 0015). Public API
  (`resolveOverride`, `OverrideMap`) is unchanged.
- `RegistryClient` default `baseUrl` now resolves through `getRegistryBaseUrl()`;
  explicit `baseUrl` option still wins. Existing tests that pass a `baseUrl`
  are unaffected.

### Fixed

- A corrupt `package-lock.json` now throws
  `Error('lockfile corrupt at <path>: <message>', { cause })` instead of being
  silently treated as missing. The previous behaviour quietly re-resolved and
  overwrote the corrupted file.

### Dependencies

- Added workspace dependency on `@rifty/io` for `NotImplementedError`. No new
  external npm dependencies.
