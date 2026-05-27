# Changelog

## [Unreleased]

### Changed

- **M11 nested install — fast-path replay for nested entries (ADR-0042
  follow-on).** Lifts the temporary opt-out the M11 first cut shipped:
  `createLockfileSource` now resolves each `(name, range, parent)` via
  the new `pinnedEntryForParent` walk-up, so a lockfile carrying
  diamond-conflict nested entries replays entirely from cache instead
  of falling through to live resolve. The walk-up mirrors Node's
  resolver, applied to v3 lockfile keys: starting from the parent's
  install path, check `<scope>/node_modules/<name>` at each ancestor
  scope, take the first hit; root-scope requests (`parentInstallPath
  === ''`) reduce to the previous bare-name lookup. `chooseSource`'s
  `lockfileHasNestedEntries` opt-out is removed. Verified end-to-end
  against the live `express@^4` opt-in: second install over the same
  vfs is 86 packages / 44 ms / 0 packuments / 0 tarballs (first
  install: 18 100 ms / 72 packuments / 83 tarballs).
  - New helpers in `installer-lockfile-reader.ts`:
    `pinnedEntryForParent(lockfile, name, parentInstallPath) →
    { installPath, entry } | undefined` and the `PinnedEntryLookup`
    interface. `lockfileCovers` and `lockfileSubgraph` are routed
    through the walk-up so transitive subgraph divergence checks see
    nested copies too.
  - `ResolutionSource.resolve` signature changes from
    `(name, range, parent: string | undefined)` to
    `(name, range, ctx: { parentName, parentInstallPath })` — the
    lockfile source uses `parentInstallPath` for walk-up; the
    registry source keeps using `parentName` for `parent>child`
    override scope.
  - `ResolvedPin` gains an optional `installPath` field. When set
    (lockfile-source replay), the walk honours it verbatim, which
    keeps on-disk placement matching the lockfile even if the
    operator reorders `dependencies` between installs. When absent
    (live-source), the walk computes placement via the existing
    first-wins-flat + nest-on-conflict rule (now extracted as
    `choosePlacement`).
  - `EBROKENLOCK` messages on missing or malformed entries now
    include the resolved install path / the parent path used for
    walk-up, surfacing which scope the lookup gave up on.
  - Behavioural regression-detector lives in
    `tests/integration/nested-install.test.ts` test #2: it now
    asserts `second.calls.packument === 0` (previously
    `toBeGreaterThan(0)` — the opt-out cost) and adds a sorted-deep-
    equal on the resolved set's `installPath` shape across the two
    installs.
- **M11 nested install (ADR-0042).** The flat-only linker is replaced
  with first-wins-flat + nest-on-conflict placement, driven by
  `walkAndPin` in `installer.ts`. Diamond version conflicts no longer
  throw `EVERSIONCONFLICT`; instead the second version installs at
  `<parentInstallPath>/node_modules/<name>` and both placements coexist
  on disk and in the lockfile. Lockfile entries are now keyed by
  install path (`node_modules/<name>` for hoisted, full path for
  nested) — npm-v3 compatible shape. The opt-in live `express@^4`
  install now succeeds end-to-end (86 packages, `ms × 5`, `debug × 3`,
  `statuses × 3`, etc.); closes M9's "Nested install for version
  conflicts" open-acceptance item.
  - `ResolvedPackage` gains an optional `installPath` field; `link()`
    writes by that path; `buildLockfile` keys by it.
  - `createRegistrySource.resolve` no longer throws
    `EVERSIONCONFLICT` — placement moves to the walk.
  - `chooseSource` opts out of the lockfile fast path when the
    existing lockfile contains any nested entry (the fast-path
    resolver still does bare-name lookups); falls through to live
    resolve, which knows how to re-derive nesting. Lifting that opt-
    out is a follow-on (superseded by the entry above on
    2026-05-27).
  - Semver `matchBranch` now strips operator-trailing whitespace
    (`>= 2.1.2 < 3` ≡ `>=2.1.2 <3`) — npm packuments emit the spaced
    form for transitive constraints and the live express graph hit it
    immediately.

### Fixed

- **Algorithm-aware integrity verification.** `computeIntegrity(bytes)` was
  hard-coded to SHA-256, but every modern npm packument carries a
  `sha512-…` `dist.integrity` since npm@5. The live-express smoke run on
  2026-05-27 failed with "expected sha512-…, got sha256-…" for every real
  package fetched from `https://registry.npmjs.org`. The function now
  accepts `(bytes, algorithm)` with `algorithm` defaulting to `'sha512'`,
  and `fetch-and-unpack` parses the algorithm from the supplied
  `spec.integrity` so the verifier and the spec always agree. New
  exports: `IntegrityAlgorithm` (the supported alphabet) and
  `parseIntegrityAlgorithm(string)` (returns `null` on unrecognised
  prefixes, which `fetchAndUnpackToCache` surfaces as a loud
  `EINTEGRITY` "Unsupported integrity algorithm" — never a silent fall
  through to a wrong-algorithm comparison). The vendored
  integration fixtures (ADR-0021) keep their `sha256-…` pins; the
  algorithm parser handles both transparently.
- **Partial-version ranges in semver.** `parse('4')` returned `null`
  because the regex required three dotted components, so `matchesRange('5.2.1', '^4')`
  evaluated to `false` and the installer fell through to a silent
  `dist-tags.latest` (resolved express to 5.x instead of the requested 4.x).
  Added a new internal `coerce(base)` that zero-fills missing minor / patch
  for comparator bases; `parse()` itself stays strict for fully-qualified
  released versions. `matchCaret` / `matchTilde` now derive `[min,
  maxExclusive)` bounds per npm semver semantics — including the corner
  cases `~4 ≡ ^4 (>=4 <5)`, `^0 ≡ >=0 <1`, `^0.0 ≡ >=0.0 <0.1`, and
  bare `'4'` acting as the `4.x.x` x-range. `>=` / `<=` / `>` / `<` / `=`
  partial bases zero-fill via a `compareToBase` helper (slightly
  permissive vs node-semver's `>4 ≡ >=5.0.0` interpretation, accepted
  trade-off for installer use). 8 focused regression tests added in
  `semver.test.ts`.
- **No silent `dist-tags.latest` substitution on explicit ranges.** When
  `pickBestVersion(_, '^4')` returned `null` the installer fell back to
  `packument['dist-tags'].latest` regardless of whether the operator had
  asked for a specific range. That silently violated the operator's semver
  intent — exactly what masked the partial-range bug above. The fallback
  now only fires when the range is genuinely unconstrained (`null`, `''`,
  `'*'`, `'latest'`); explicit ranges that match no published version
  throw `No matching version for <name>@<range>`. New `rangeIsUnconstrained`
  helper keeps this symmetric with `matchesRange`'s special-cases. Two
  new tests in `installer.test.ts` pin the contract.

### Changed

- **Hard-throw on malformed lockfile entries (follow-ups doc item #21).**
  `createLockfileSource.resolve` now throws `EBROKENLOCK` when an entry is
  missing or missing `resolved`/`integrity`. Previously the lockfile fast
  path returned `null` on these and the walk silently stopped with a
  partial pinned set — corruption that looked like network slowness in
  user reports. `ResolutionSource.resolve` return type narrows from
  `Promise<ResolvedPin | null>` to `Promise<ResolvedPin>`; the
  silent-stop branch in `walkAndPin` is removed.
- **Test fixtures consolidated.** Five npm-client test files
  (`installer.test.ts`, `installer-lockfile.test.ts`,
  `installer-peer-optional.test.ts`, `installer-pipeline.test.ts`,
  `unpacker.test.ts`) shared a hand-rolled `buildHeader` +
  `makePackageTarball` helper that had drifted across copies. They now
  import from `packages/npm-client/src/_test-fixtures/tar-builder.ts`;
  ~290 lines of duplicate test code deleted. The shared module is
  test-only (no public re-export).

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

- Install pipeline unified — single traversal driver (`walkAndPin`) with two
  pluggable `ResolutionSource` implementations (`createLockfileSource` /
  `createRegistrySource`). The lockfile-fast-path and live-resolve pipelines
  no longer carry two copies of the traversal loop, the `Pinned =
  (lockfileEntry | manifest) → PinnedPackage` adapter, or the peer-deps
  hydration check; one `pinToPackage` adapter is reached from a single
  place. `install()` is now ~30 lines orchestrating four collaborators
  (`chooseSource` → `walkAndPin` → `link` → `writeLockfileIfChanged`).
  Public API (`install`, `InstallOptions`, `InstallResult`) is unchanged.
  Closes the P0 finding from the 2026-05-26 npm-client audit. No new
  external dependencies and no new files.
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
