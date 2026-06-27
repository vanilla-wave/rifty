# Changelog

## [Unreleased]

### Fixed

- **Registry client retries transient failures (429 / 5xx / network).** `RegistryClient`
  now retries a rate-limited or transiently-failing fetch with exponential backoff,
  honoring a `Retry-After` header (real-npm behavior). A single 429 from the shared
  registry proxy no longer hard-aborts a many-package cold install (the express+sqlite
  "Failed to fetch packument … 429"). Permanent 4xx (e.g. 404) never retries; bounded
  by `maxRetries` (default 3); `sleep` is injectable for tests.
- **Expected native-platform optional skips read as skips, not errors.** An optional
  `@rolldown/binding-<platform>` (or any `cpu`/`os`-pinned native sibling) that
  `ENATIVEUNSUPPORTED`-skips per ADR-0051 now logs a calm
  `npm: skipped optional native dependency <name> (expected — rifty runs JS+WASI only)`
  instead of `… could not be installed: ENATIVEUNSUPPORTED …` — a pack of platform
  bindings no longer looks like a wall of install failures. Genuine optional failures
  (network/missing) keep the louder "could not be installed" wording.

### Added

- **Native policy accepts WASI packages (`cpu: ["wasm32"]`, ADR-0156).** Rolldown's
  `@rolldown/binding-wasm32-wasi` optional dependency is now installable while
  platform-native siblings still skip/abort via `ENATIVEUNSUPPORTED`.

- **`InstallOptions.onPackage` per-package progress hook (ADR-0134).** Optional
  callback firing once per unique `(name, version)` when its tarball resolves
  (cache or network), with `cacheHit`; fires on both the lockfile fast path and
  live resolve, never for failed fetches (incl. skipped optionals). Callback
  throws are caught + warned. Event order is fetch-completion order. Consumer:
  the playground terminal streams `npm: + <name>@<version>` lines (ADR-0135).

### Performance

- **npm install: bounded-concurrency packument prefetch (ADR-0175).**
  `walkAndPin` now warms sibling registry packuments through a bounded in-flight
  pool (cap 8) as soon as dependency names are discovered. The placement walk
  remains strictly serial and request-ordered (`resolve -> choosePlacement ->
  recurse`), so first-wins-flat layout is unchanged; the express diamond still
  installs `ms@2.1.3` flat and `ms@2.0.0` nested under `finalhandler`.
  `InstallOptions.packumentCache` is still the success cache, with failed
  packuments staying loud when the serial visit reaches them. Guard:
  `src/installer-concurrency.test.ts` asserts packument `peakInFlight > 1` while
  pinning the diamond layout.
- **`pickBestVersion` is a single linear max-scan, not filter+sort (#8).** Was `versions.filter(matchesRange).sort((a,b)=>compare(b,a))[0]` — an O(n log n) sort plus an intermediate candidate array per resolution. Now one forward pass keeping the running max via `compare(v, best) > 0`. Selection is byte-identical for every input: `Array.prototype.sort` is stable, so the old descending sort kept the EARLIEST input occurrence among `compare`-equal candidates at `[0]`; the strict `> 0` scan also keeps the earliest-encountered max (a `>= 0` would pick the last — a divergence the parity test pins via a `2.0.0` / `2.0.0+build` tie). Empty/no-match → `null`, as before. `matchesRange`/`compare` unchanged. Behavior-preserving / contract-stable (ADR-0081 rule 5; CHANGELOG-only). Guard: `src/semver.test.ts` parity oracle (large unsorted list × releases/prereleases/ranges asserted equal to the old filter+sort pick; stable tie-break; empty-candidate null). Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#8).
- **Linker dedups parent dirs + parallelizes file writes (#7).** `link()` did, per file, `mkdir(parentDir,{recursive})` then `writeFile` — serial, re-resolving every path segment per file (O(M*D) `getDirectoryHandle` round-trips on OPFS). It now collects the DISTINCT parent dirs of a package's files into a `Set`, pre-creates ALL of them FIRST (serially — closes the shared-parent double-create / ENOENT-on-write race), then fans out the writes via `Promise.all`. The writes are an independent write-only fan-out into already-created dirs, so order-independent; final filesystem state (dirs, files, bytes) is identical. mkdir count drops from O(files) to O(distinct-dirs). No public-API change. Behavior-preserving / contract-stable (ADR-0081 rule 5; CHANGELOG-only). Guard: new `src/linker.test.ts` (mkdir count == distinct dirs, not file count; every file lands byte-exact across nested dirs). Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#7).
- **npm install: bounded-concurrency tarball fetch (#24).** `walkAndPin` awaited each `fetchAndUnpackToCache` inline, fully serializing the network wait. It now defers the fetch through a zero-dep counting `Semaphore` (`src/utils/semaphore.ts`, default cap 8 — a pure perf knob, any value yields the identical tree) and awaits the collected tasks after the walk; concurrent same-`(name,version)` fetches collapse to one network call via an in-flight map. **Determinism-vs-throughput invariant (non-negotiable):** the placement walk (`resolve → choosePlacement → flatByName claim → recurse`) stays STRICTLY SERIAL and request-ordered — first-wins-flat is claimed after `await source.resolve` (version known only post-resolve), so running placement concurrently would make the flat-slot winner depend on resolve-completion order, breaking the express-diamond contract (`ms@2.1.3` flat, `ms@2.0.0` nested). ONLY the tarball fetch is parallelized; bytes feed `extractTarGz`/`files` alone, never the dep walk. **One exception preserves a subtle old semantic:** an OPTIONAL-boundary node (a dep reached as a direct optional child) awaits its OWN fetch BEFORE recursing — exactly like the old serial walk — so a failed optional fetch warn-and-skips its WHOLE subtree (the dep AND its transitive required children) before that subtree is ever walked. Required deps keep the deferred/concurrent fetch; only the optional boundary trades concurrency for this correctness. Tree + on-disk layout (including the optional-subtree-skip-on-fetch-failure case, which matches real npm: no orphaned required grandchild) identical → behavior-preserving (ADR-0081 rule 4 does not fire; CHANGELOG-only). The invariant is recorded as a code comment at the semaphore site. **One observable delta among genuinely-broken inputs:** with multiple concurrent REQUIRED-dep fetch failures, which error surfaces first is no longer deterministic (siblings already in flight run before the first rejection lands); a single failure throws the same error as before, and optional-dep fetch failures are still caught-and-warned with the exact message (via `Promise.allSettled` + per-task required/optional tagging). Guard: existing `src/installer.test.ts` express-diamond determinism gate (UNMODIFIED) + new `src/installer-concurrency.test.ts` (byte-identical layout 20×; one network call per distinct `(name,version)`; in-flight dedupe; optional non-fatal / required-fatal under concurrency; optional-subtree fully skipped on fetch failure — no orphaned grandchild, lockfile keys exactly `['', 'node_modules/main']`) + `src/utils/semaphore.test.ts` (cap never exceeded, FIFO, release-on-reject). Per `docs/perf/js-runtime-perf-audit-2026-06-05.md` (#24, gate G5). **Dedup-gate correctness fix (#24 follow-on):** the old serial gate (`pinned.has`, set only AFTER a successful pin) could not survive the deferred fetch (pins land post-walk), so it became a synchronous `scheduled` set claimed pre-fetch. That set was never cleaned when an OPTIONAL-boundary fetch REJECTED — so a name that failed as optional via one parent, then was REQUIRED via another (later-visited) parent, hit `scheduled.has` → early-return → silently dropped a required dep (and its subtree) while the install reported SUCCESS; real npm and the old `pinned.has` walk ABORT. Fix: on optional-boundary fetch rejection roll back the synchronous claims this visit made (`scheduled` entry, plus the `flatByName` first-wins claim iff this visit owns it) before re-throwing to the parent's optional catch, so a later required visit re-attempts and aborts as npm does. Guard: new `src/installer-concurrency.test.ts` ("a failed OPTIONAL-boundary fetch does not poison a later REQUIRED visit of the same name") — graph root→a(req)→shared(OPTIONAL, fetch rejects), root→b(req)→shared(REQUIRED)→deep(req), a-before-b ⇒ install MUST throw.

### Added

- **Package.json-driven install + `.bin` launcher shims (M11).**
  `install({ vfs, cwd, registry })` now reads `<cwd>/package.json`, deriving the
  root name/version, `dependencies`, `devDependencies`, root
  `optionalDependencies`, and string-valued `overrides`. Root optionals keep the
  existing warn-and-skip semantics, while `file:`/local paths, `workspace:`,
  git/GitHub shorthand, URL tarball, and npm-alias specs throw named
  `NotImplementedError`s. Package
  install-time lifecycle scripts (`preinstall`, `install`, `postinstall`) also
  throw named `NotImplementedError`s instead of being silently skipped. Registry
  `prepare` metadata is ignored because published tarballs are already prepared.
  Registry manifests and lockfile entries now preserve `bin`; `link()` writes
  containing-scope `node_modules/.bin` LAUNCHER shims (no symlinks per
  ADR-0050) — `#!/usr/bin/env node` + `import('../<pkg>/<bin>')`, not a byte
  copy: a copy breaks bins that resolve relative imports (vite/tsc). Lockfile
  replay recreates them without refetching packuments. The first M11 cut only
  wrote the shims; shell-side `.bin` PATH lookup and owner-worker execution
  landed later, so installed CLIs are now invokable by name. The playground
  `npm install` wrapper and Real Vite worker bootstrap call the
  package.json-driven API.
- **Native-dependency install policy (ADR-0051).** The installer now throws
  `ENATIVEUNSUPPORTED` (with `packageName`/`version`/`reason`/`platform`) when a
  resolved package pins `cpu` to a non-`wasm` set (a compiled artifact rifty
  can't run) and has no shadow substitution. Required natives abort; **optional**
  natives skip-with-warning (inherits `walkAndPin`'s optional catch — esbuild's
  `@esbuild/*` platform optionals skip, Vite still installs); shadow-substituted
  (`bcrypt→bcryptjs`) and pure-JS packages are unaffected. `cpu`-keyed (not `os`)
  to avoid false-positives. `VersionManifest` gains additive `os?`/`cpu?`. New
  `docs/compat/incompatible-packages.md`. Forcing consumer: `opencode-ai`
  (native binary). Tests: `src/installer-native-policy.test.ts`.

### Fixed

- **Unconstrained installs prefer the registry `latest` dist-tag over higher prereleases.**
  `npm install prettier`/`{ prettier: '*' }` now resolves the package's
  `dist-tags.latest` first, matching npm's bare-install behavior, instead of
  letting `pickBestVersion('*')` choose a newer alpha such as
  `4.0.0-alpha.13`. Explicit ranges still never silently fall back to
  `latest`; a non-matching range keeps throwing "No matching version".
- **Registry tarball `prepare` metadata no longer blocks installs.** Published
  registry packages can carry `scripts.prepare`, but npm does not run that hook
  when installing dependency tarballs from the registry. The live Vite bootstrap
  hit this on Netlify (`NotImplementedError: npm-client.lifecycle.prepare`) and
  stopped before the dev server could start. Registry packages still hard-fail
  on `preinstall`, `install`, and `postinstall`; root package lifecycle handling
  is unchanged. Guard: `src/installer.test.ts`.
- **Baked esbuild substitution runs before lifecycle gating.** The installer now
  exercises the shadow-registry `esbuild` redirect before it can fail on the
  real package's native-binary `postinstall`, covering the Vite install path
  used by the Netlify playground smoke. Guard: `src/installer.test.ts`.
- **Semver prerelease-exclusion (node-semver rule).** A version carrying a
  prerelease tag now only satisfies a range when some comparator in the matching
  branch shares its exact `[major,minor,patch]` AND carries a prerelease.
  Previously `^4` matched `5.0.0-beta.3` (it sorts below the `<5.0.0` bound), so
  `install({express: '^4'})` resolved to an **express 5 beta**, dragging in
  `body-parser@2-beta` + `raw-body@3-beta` and breaking express@4's body parser.
  This mis-resolved *any* `^X` / range request whenever a next-major prerelease
  existed. Found running real express@4 end-to-end; covered by
  `packages/npm-client/src/semver.prerelease.test.ts`.

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
  `@riftydev/shadow-registry` workspace package (ADR 0015). Public API
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

- Added workspace dependency on `@riftydev/io` for `NotImplementedError`. No new
  external npm dependencies.
