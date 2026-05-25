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
- `readExistingLockfile` now throws
  `NotImplementedError('npm-client.lockfile.v{1,2}')` when it encounters
  npm 5/6/7-era lockfiles (`lockfileVersion: 1` or `2`) instead of silently
  returning `null`. The previous fallthrough caused `install` to do a full
  fresh resolve and overwrite the user's lockfile with a v3 — data loss
  disguised as caching. Callers see the gap loudly.
- `install` no longer rewrites `package-lock.json` when the serialized
  content is byte-identical to what's already on disk. Both the cache-hit
  fast path and the live-resolve path now go through
  `writeLockfileIfChanged`, which honours the ADR-0023 promise of a stable
  user-visible mtime when the install was a functional no-op.
- Lockfile fast path now re-applies overrides (user + baked-in) before
  replaying pins (P1 semantic divergence fix, ADR-0023 §"Implementation
  notes (2026-05-26)"). Previously, adding an `overrides` entry that
  redirected a locked package to a different name silently no-op'd until
  something forced a full live resolve — the fast path replayed the
  original pin and ignored the override. Now each top-level request and
  every transitive subgraph entry is walked through `resolveOverride()`;
  any redirection (different name, or a tighter range that the locked
  version no longer satisfies) triggers a fallthrough to live-resolve,
  treated as a cache miss. Coverage: 3 unit tests in
  `installer-lockfile.test.ts`.

### Dependencies

- Added workspace dependency on `@rifty/io` for `NotImplementedError`. No new
  external npm dependencies.
