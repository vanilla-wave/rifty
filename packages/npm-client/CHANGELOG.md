# Changelog

## [Unreleased]

### Added

- `fetchAndUnpackToCache(spec, ctx)` — single source of truth for the
  `cache → fetch → integrity-check → write` trio used by both the lockfile
  fast path and the live-resolve path. Lives in `src/fetch-and-unpack.ts`;
  exported as an internal helper (not part of the public API, no
  `src/index.ts` re-export — these call sites are intra-package). Closes
  D-F from the 2026-05-26 architecture review: previously the two pipelines
  had been copy-pasted (`installer.ts:96-121` vs `:189-211`) and had
  already drifted. See `### Fixed` below for the behavior unification.
- `LockfileEntry.peerDependencies` (optional). Persisted on each
  non-root entry so the lockfile fast path can run the same
  missing-peer warn pass as the live-resolve path without re-fetching
  every packument. Backward-compatible: pre-existing v3 readers (including
  npm itself, which has stored this field on `lockfileVersion: 3` entries
  since npm 7) ignore unknown fields; consumers that don't care simply
  skip the warn pass. **Peer-warning strategy choice (D-F):** we picked
  *persist on lockfile entry* over *recompute from packument*. Recomputing
  on every fast-path install would have required a packument round-trip per
  package, defeating the ADR-0023 cache benefit and re-introducing exactly
  the latency the lockfile reuse exists to avoid. Persisting in the lockfile
  is O(1), backward-compatible, and what npm itself does.
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
- **Live-resolve path now verifies fetched-tarball integrity** against the
  pinned hash (manifest's `dist.integrity` or, on a partial re-resolve,
  the lockfile entry's `integrity`). Previously the live path's silent
  acceptance of any bytes the registry returned was a "no silent stubs"
  violation — a registry returning the wrong tarball for a (name, version)
  pair would propagate unnoticed into `node_modules`. Throws
  `EINTEGRITY` (matching the fast path's behavior) on mismatch. This is
  the network-side half of the D-F drift; the cache-side half (existing
  ADR-0023 "tampered cache → refetch" corruption guard) is preserved
  verbatim — `VfsTarballCache.get` still returns `null` on integrity
  mismatch so that operationally common disk corruption stays
  self-healing instead of being a hard failure. The trade-off (loud-throw
  on network bytes vs self-heal on cache bytes) is documented inline at
  the top of `fetch-and-unpack.ts`. Coverage: 5 unit tests in
  `fetch-and-unpack.test.ts` + 2 pipeline tests in
  `installer-pipeline.test.ts`.
- **Lockfile fast path now emits the missing-peer warning pass.**
  `peerDependencies` is hydrated from the lockfile entry into the
  in-memory `PinnedPackage` record before `warnUnsatisfiedPeers()` runs.
  Previously the fast path silently skipped the warn pass because v3
  lockfile entries did not carry `peerDependencies`; user-observable
  behavior thus diverged between an install that hit the cache and one
  that didn't. Both paths now produce the same `console.warn` output for
  the same input. Coverage: 1 pipeline test in `installer-pipeline.test.ts`.

### Dependencies

- Added workspace dependency on `@rifty/io` for `NotImplementedError`. No new
  external npm dependencies.
