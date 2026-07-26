# Changelog

## [Unreleased]

### Changed

- Shadow recipe v2 now owns exact request admission, complete registry
  dependency projection, materialized bins, and replay provenance. One shared
  bin linker serves acquired and substituted packages; lockfiles retain only
  the successfully reachable optional graph (ADR-0323).

### Added

- **Cancellable package acquisition (ADR-0314).** `InstallOptions.signal` plus
  direct `RegistryRequestOptions.signal` propagate through registry, Eddy,
  retry, and streamed-body waits; abort keeps its causal reason and cannot
  degrade into fallback or optional-dependency skip. Registry packument and
  tarball methods accept the new optional request-options argument.

- **Builtin shadow-substitution runtime assets (ADR-0308).** Exact applied
  recipe facts produce a canonical asset plan; a digest-verified manager
  acquires each npm member once and mints a strict one-shot ready/read port for
  admitted child entries. The exact `esbuild@0.28.0` recipe now
  synthetic-materializes its CJS/ESM delegate and loud CLI bin without the
  retired `@esbuild/wasi-preview1` alias. Its ready/read/cancel correlation
  engine remains package-local under the recorded layer constraint (ADR-0321).
- Shadow recipe provenance now round-trips through lockfile markers plus a
  canonical applied trace. Synthetic replay performs zero registry reads;
  registry-backed install-only recipes retain exact acquisition provenance.
- Shadow CAS readiness now distinguishes persisted OPFS, best-effort OPFS, and
  memory sessions, durability-flushes mirror writes, reads back through the
  actual persisted VFS, and refuses receipts/pointers after quota, torn-write,
  lifecycle-abort, or port-death faults. Each CAS object is SHA-verified once
  when loaded, then port reads copy the retained verified bytes without another
  storage read or hash; a cold reopen still validates persisted bytes.

- `serializePackageJson()` provides one canonical byte spelling for finite
  plain-data manifests shared by host plans, Workbench definitions, and snapshot
  tooling; lossy object shapes, accessors, cycles, and unsupported JSON leaves
  reject before output.

- **Structured install acquisition provenance (ADR-0258).** Every
  `InstallResult` now reports `lockfile | metadata` resolution, each unique
  package's `cache | eddy | registry` transport, and the exact Eddy fallback
  reason. A validating-registry failure after Eddy declines throws both causes;
  legacy `source` and `onPackage.cacheHit` remain lossy compatibility fields.

- **`resolveEddyClosure`** (stale-pin SWR primitive, ADR-0216): POST the
  canonical request and read the response ONLY up to the manifest member
  (early-cancel via `streamTarEntries` — the tarball tail never downloads),
  returning `{ closureHash, resolvedAt, storeDurable }` (`storeDurable` = the
  `x-eddy-store-durable` proof, required before pinning a never-GET-verified
  hash — mirrors the installer's learnable gate). Bounded on every phase
  through the ADR-0201 chokepoint (header wait, decline-body drain, body
  no-progress); throws on decline/HTTP error/stall/malformed manifest
  (including a non-parseable `resolvedAt`). No wire-protocol change.
- **`InstallResult.resolvedAt` + `InstallResult.resolvedVia`**: eddy-sourced
  installs expose the adopted bundle's validated `manifest.asOf.resolvedAt`
  (the stale-pin honesty line reports the SERVED resolution's age, not the
  pin file's) and the attempt provenance (`'get' | 'post'` — the underlying
  REQUEST KIND: a consumed prefetch reports the kind it rode, pinned GET or
  unpinned POST) — hash equality cannot distinguish a cache serve from a POST
  that recomputed the same closure, and the playground's pin/`as-of` policy
  hangs off the difference. `EDDY_STORE_DURABLE_HEADER` moved to `eddy-request.ts` and is
  exported from the barrel — one wire-protocol home; the eddy server now
  imports it instead of duplicating the literal (no cross-package string
  drift, same rationale as `MANIFEST_FILE`).

### Fixed

- Strict-decode the complete shadow-plan mutation matrix at planner, manager,
  port-server, and port-client ingress; manager/port failures now retain their
  typed boundary errors instead of leaking raw decoder exceptions.

- Concurrent shadow-manager close callers join the same terminal
  storage-close outcome.
- Install cancellation now checkpoints the package linker between settled
  mutation steps, waits for every write in the active batch, and stops before a
  post-abort bin shim write. An abort leaves the claim untrusted and returns its
  causal reason; the next explicit install repairs the partial tree from the
  existing lockfile/cache, matching npm's idempotent repair.

- Shadow-plan object ingresses reject hidden extra or required fields instead
  of accepting data that a structured clone or canonical digest would omit.

- Partial lockfile misses now replay compatible retained edges and resolve only
  changed frontiers, including exact nested-path rebasing and optional rollback.
- Transitive lockfile range drift now follows `npm install`: only the drifted
  frontier re-resolves instead of applying `npm ci`-style strict rejection.
- Direct dependencies reserve root-visible slots before descendant traversal;
  failed optional roots reserve nothing and required demand cannot be suppressed
  by an earlier optional attempt (ADR-0303).
- Structural lock, placement, and tar-path corruption remains loud across root
  and transitive optional boundaries; only ordinary optional acquisition and
  archive failures warn-and-skip.

- Package tarball ingress now rejects absolute/parent-traversal members before
  linking and exposes one host batch preflight over every actual package target.
  Rifty uses that preflight to reject reserved install claims before the first
  `node_modules` write (ADR-0261), for registry and Eddy/cache replay alike.

- Builtin shadow substitution now checks the caller's package range at one
  shared fresh/replay resolution boundary. An esbuild request that excludes the
  exact recipe version fails before network, lockfile lookup, provenance, or
  writes; an explicit user override continues to own its replacement range.

- **Standard-path registry fetches are stall-bounded.** `RegistryClient`
  packument/tarball fetches now bound BOTH phases (headers + body) through the
  shared `bounded-fetch` chokepoint (no-progress window, default 10s + 128MiB
  byte cap); a breach counts as transient (rides the existing retry ladder)
  then fails loudly naming the operation, phase, and bound — a hung registry
  can no longer park `npm install` forever. New
  `RegistryClientOptions.stallTimeoutMs` mirrors
  `InstallOptions.resolverStallTimeoutMs` (type now exported from the barrel).
  Decision record (public API + the no-progress-vs-npm's-300s-total delta):
  ADR-0201. The eddy header-bound twins (`installer.ts`, `eddy-prefetch.ts`)
  melted into the same chokepoint (`unbounded-read` class-kill), and
  never-consumed non-OK bodies (registry retry ladder + the eddy attempt
  pipeline's 404/5xx responses) are now CANCELLED via one `discardBody`
  helper — an unread body holds its h2 stream open.

### Fixed (PR #107 round 22)

- **`InstallResult.closureHash` no longer leaks unproven POST hashes.** Eddy
  installs still report `source: 'eddy'`, but learned-pin hashes are returned
  only for content-addressed GET/prefetch responses or POST responses whose
  `x-eddy-store-durable` header proves the immutable store is servable.

### Fixed (PR #107 round 21)

- **`EddyBundleContents` stays source-compatible.** `memberNames` is now optional
  on the public contents shape; `unpackEddyBundle()` returns the narrower
  `UnpackedEddyBundleContents` when validators need the observed member order.

### Fixed (PR #107 round 20)

- **Eddy adoption proves every seeded tarball survives cache replay.** A bounded
  cache that retained only the last bundle member could pass the old probe while
  earlier packages were fetched from the registry under `source: 'eddy'`. The
  client now reads back every seeded tarball before adopting the bundle.

### Fixed (PR #107 round 17)

- **Eddy JSON declines read under the tarball stream's bounds.** A resolver that
  sent `content-type: application/json` then held the body open parked
  `npm install` forever — `response.json()` has no timeout. The decline body now
  drains through the shared `drainBodyBounded` (no-progress timeout + byte cap),
  so a stalled decline fails the attempt → standard install, never a hang.
- **Eddy adoption proves the tarball cache is retentive.** A no-op/non-retentive
  `tarballCache` seeded nothing yet reported `source: 'eddy'` while replaying
  every package from the REGISTRY (a provenance lie, and a hard failure offline).
  Adoption now reads a seeded entry back; a miss declines to the standard path.

### Fixed (PR #107 round 13)

- **`prefer: 'online'` now really forces a fresh recompute.** The pinned
  GET-by-hash and the prefetch are BYPASSED under online preference (both
  serve a content-addressed cached closure); only the POST — carrying
  `prefer` so the server skips its mutable tier too — runs.
  `startEddyPrefetch` likewise ignores a pinned `closureHash` under online
  and POSTs.
- **Eddy attempts are bounded through the HEADER phase.**
  `resolverStallTimeoutMs` (default 10s) now also covers the fetch itself —
  a resolver whose connection/headers hang fails the attempt (abort + race)
  and falls through to the next attempt / standard install, instead of
  parking `npm install` forever. Same bound added to the prefetch fetch.
- **The eddy bundle lockfile is STAGED, not pre-committed.** Adoption used to
  write `package-lock.json` before link/shims ran — a later failure left the
  resolver's lockfile in the project. The staged lockfile now drives the
  install in memory and the final lockfile is written only at the success
  point (as the standard path always did); any post-adoption failure leaves
  the previous lockfile untouched.
- **`EddyBundleContents.memberNames` + exported `MANIFEST_FILE`/
  `LOCKFILE_FILE`** so eddy's durable store can reject bundle objects with
  unexpected extra members exactly like client adoption does (one container
  contract, no cross-package string drift).

### Added

- **Install-time shadow internals shims + loud substitution lines (ADR-0188).** `install()` now
  applies `@riftydev/shadow-registry` `internalsShims` after linking, into each pinned copy's
  actual install path (nested/hoisted-aware): rollup's `dist/native.js` → real
  `@rollup/wasm-node` parser (companion-injected into the dep walk at EXACTLY rollup's version;
  replay re-derives it — no lockfile format change), plus the `lightningcss` alias package
  materialized next to its baked-override target. Installed trigger version outside
  the shim's proven range → `NotImplementedError('shadow-registry.<pkg>@<version>')`; a replayed
  companion at a drifted version → `EBROKENLOCK`. Every baked substitution prints via the new
  `InstallOptions.onSubstitution` sink (default `console.warn`), on fresh install AND lockfile
  replay. Esbuild's synthetic recipe reports its own materialization provenance;
  `npm: rollup@<v> internals patched from shadow registry` remains the shim shape.
  User `overrides` do not print (`resolveOverride` returns `source: 'user' | 'baked'`).
  Tests live in `installer-shadow-shims.test.ts`.
### Added (eddy v1.2, ADR-0194)

- **`InstallResult.closureHash`.** Set iff `source === 'eddy'` — the adopted bundle's
  `manifest.asOf.closureHash`, threaded out of `consumeEddyResponse` → `tryEddyFastPath`
  so callers can persist learned pins (`requestKey → closureHash`) and turn the next
  identical dep set into a cacheable `GET /bundle/<hash>`.
- **`InstallOptions.packumentCache` widened to `PackumentCacheLike`** (minimal
  `{get, set}`; `Map` satisfies it structurally) so callers — eddy's process-wide TTL
  cache — can inject policy-aware caches without a Map subclass.
- **`closureHashOf(lockfile)` + `canonicalClosureJson(lockfile)`.** The stable content hash
  of a resolved closure (ADR-0182 §6, the immutable-tier key) is now exported here as ONE
  shared async (WebCrypto) implementation — eddy awaits it to stamp the manifest; the client
  re-derives it to verify a bundle's identity. The canonical serialization is exported
  separately so `@riftydev/eddy`'s pre-existing SYNC `closureHashOf` (string API, node:crypto)
  hashes the same bytes and cannot drift.

### Fixed (eddy v1.2 review follow-ups, ADR-0194)

- **Duplicate manifest `file` entries are declined.** Two required
  name@version entries sharing one member file collapsed in the by-file map:
  the single member verified against the surviving entry, the seeded-count
  check compared collapsed sizes and the completeness gate saw both
  name@version in the manifest ARRAY — the bundle adopted as `eddy` with one
  package's tarball never seeded (silently replayed from the ordinary
  registry). Malformed → declined at member 1; the S3 store misses the same
  shape. RED-checked roundtrip + store regressions.
- **`closureHashOf` is DEEPLY canonical.** Only the top-level package keys were
  sorted; entry objects were stringified raw, so the same resolved closure with
  a different `dependencies`/`bin`/`peerDependencies` insertion order hashed
  differently — duplicate immutable objects and cache misses for one closure.
  `canonicalClosureJson` now recursively key-sorts nested records (values
  untouched). Applies before any durable content-addressed store exists in prod,
  so no stored hashes are invalidated. `bundleCompletenessGap` is also exported
  from the public index so eddy's durable store validates objects exactly as
  strictly as the client adopts them. RED-checked nested-order tests.
- **A completed bundle GET reads to TRUE EOF — the browser HTTP cache keeps
  it.** The streaming reader used to stop at the first end-of-archive zero
  block and cancel the body with the terminator tail still on the wire; a
  cancelled body makes the browser DISCARD the response from its HTTP cache,
  silently defeating the immutable `GET /bundle/<hash>` tier (the pinned /
  learned GET is fast BECAUSE the cache holds it). The reader now drains the
  (tiny, still stall/cap-bounded) remainder to true EOF on the success path;
  early aborts (gate declines, bound violations) still cancel. RED-checked
  full-consume-never-cancels regression.
- **A FAILED pinned prefetch falls through to the direct pinned GET, not
  straight to POST.** The attempt pipeline is `prefetch → GET → POST`; a
  dedup condition skipped the GET whenever the prefetch was the same pin's
  fetch — correct for a SUCCESSFUL prefetch (which short-circuits anyway) but
  wrong for a stalled/failed one, which jumped to the origin POST and lost the
  cacheable GET tier exactly when the retry was cheapest. The GET attempt is
  now unconditional (first survivor still wins). RED-checked
  stalled-pin-prefetch → GET-adopts → zero-POSTs regression.
- **Bounded prefetch drain — a never-ending bundle body can no longer hang
  `npm install`.** `startEddyPrefetch`'s deliberate eager drain (h2-stall fix)
  was an unbounded `arrayBuffer()`: a resolver that held the connection open
  parked the installer's consumed prefetch forever — no error, no fallback, a
  hung terminal. The drain now has a no-progress timeout
  (`stallTimeoutMs`, default 10s — the measured h2-stall class) and a byte cap
  (`maxBufferBytes`, default 128MB; the POST fallback streams, so a legit huge
  bundle still installs) — a violated bound rejects, the attempt pipeline falls
  through to its own GET/POST, and the dead stream is cancelled. Unit tests +
  a `client-roundtrip.test.ts` never-ending-prefetch regression, RED-checked
  against the unbounded drain.
- **Bounded DIRECT bundle streams — the same hang class on the pinned-GET/POST
  paths.** `streamTarEntries` now carries a no-progress timeout (default 10s,
  shared constants with the prefetch drain) and a total byte cap (128MB — also
  the guard against a forged tar header claiming a giant member): a resolver/CDN
  that sends a covering manifest+lockfile then stalls mid-tarball FAILS the
  attempt (dead stream cancelled) instead of parking `npm install` forever,
  and the pipeline proceeds to the next attempt / standard install. New
  `InstallOptions.resolverStallTimeoutMs` overrides the bound. Unit + a
  covering-bundle-stalls-mid-tarball roundtrip regression, RED-checked. The
  then-remaining sibling gap — STANDARD-path registry fetches had no bound
  either (pre-existing; real npm has make-fetch-happen timeouts) — is now
  closed by ADR-0201 / the shared `bounded-fetch` chokepoint above.
- **Partial-bundle completeness gate — a covering lockfile with omitted
  tarballs is declined, never adopted as `source: 'eddy'`.** The client only
  verified tarballs the MANIFEST named; a divergent/buggy resolver could send a
  covering lockfile while omitting required tarballs — the adopted lockfile
  would then replay the omissions from the ORDINARY registry on cache miss
  while reporting (and learning a pin for) `eddy`: a provenance lie. Now every
  lockfile package reachable from the request must carry `resolved`+`integrity`
  AND a manifest tarball matching its name@version+integrity
  (`bundleCompletenessGap`), gated at member 2 before any seed/write; an honest
  bundle can never trip it (the server harvests one tarball per resolved
  package from the same install that produced the lockfile). Two roundtrip
  regressions (omitted tarball; entry without replay fields), RED-checked.
- **Content-addressed bundle verification (client).** `consumeEddyResponse` now refuses a
  bundle whose `manifest.asOf.closureHash` (a) ≠ the hash a pinned GET/prefetch asked for
  (a CDN/cache mixup served the wrong object) or (b) ≠ `closureHashOf` of the bundle's OWN
  lockfile (the manifest lies about its identity). Both gate BEFORE any tarball seed or
  lockfile write, so a mis-addressed bundle is declined (→ POST/standard fallback), never
  adopted or learned as a pin. Regressions in `client-roundtrip.test.ts`.

### Added (eddy wire protocol v1.1, ADR-0195)

- **`InstallOptions.resolverClosureHash` — pinned GET-by-hash.** The fast path first tries the
  cacheable `GET <resolverUrl>/bundle/<hash>` (browser-HTTP-cache/CDN friendly, preflight-free);
  any miss/failure falls through to the POST resolve, a POST failure to the standard install.
  Same non-disableable gates on every path — a stale pin degrades, never mis-installs.
- **`InstallOptions.resolverBundleBaseUrl` — split-host CDN base.** The pinned GET may ride a
  SEPARATE hostname from the POST resolve (`bundleUrlFor(bundleBaseUrl ?? resolverUrl, hash)`) —
  real edges (Yandex CDN) refuse POST, so a stale pin on the CDN falls back to the ORIGIN's POST.
  Defaults to `resolverUrl` (single-host). Threaded into `startEddyPrefetch` too.
- **`startEddyPrefetch` + `InstallOptions.resolverPrefetch`.** Start the bundle fetch before
  `install()` runs (e.g. at owner boot) so the round-trip overlaps boot work. The handle is
  keyed on the canonical request (`canonicalEddyRequestKey`; `eddyRequestFromPackageJson`
  mirrors the installer's manifest merge) and consumed at most once — a prefetch for drifted
  deps is ignored, never trusted.
- **Streaming bundle unpack (`streamTarEntries`, internal).** The fast path consumes the
  bundle as a stream: format/v3/coverage gates run on the manifest + lockfile members (a
  decline cancels the download before tarball bytes transfer); tarballs are integrity-verified
  and seeded into the content-addressed cache as each arrives (partial seed leaves only
  verified bytes); the lockfile is still written only after every manifest-named tarball
  landed. Buffered fallback when `Response.body` is unavailable. The reader is an internal
  detail of `install()` — deliberately NOT part of the public API.

### Performance

- **Eddy POST is CORS-simple.** No `content-type` header (string body → `text/plain`), so a
  cross-origin browser client skips the OPTIONS preflight — one RTT off the cold install path
  (ADR-0195 §2). The server always parsed the body unconditionally.

### Fixed

- **Lockfile fast-path replays shadow/user overrides (eddy on override packages).** The
  lockfile-replay source (`createLockfileSource`) now applies `resolveOverride` before the
  entry lookup, matching the live-resolve source. A redirect target is stored under its own
  key (`bcrypt` → `bcryptjs`, ADR-0015 baked table), leaving no
  `node_modules/<source>` entry; `lockfileSubgraph` therefore never surfaces the source name
  so `subgraphFreeOfOverrideDivergence` cannot pre-empt it, and the replay used to look up the
  bare source name, miss, and throw `EBROKENLOCK`. This broke eddy's pre-seeded lockfile for
  ANY override package — including `vite` (→ esbuild), the flagship template: `npm install`
  aborted, so `&& npm run dev` never booted. Regression test in `installer.test.ts`.
- **Lockfile fast-path refuses a stale override target version.** With the override-aware
  replay above, a moved override RANGE (baked table bump or edited `overrides`, e.g. `foo` →
  `bar@1.0.0` becoming `foo` → `bar@2.0.0`) left the fast path silently reusing the locked
  `bar@1.0.0` — `subgraphFreeOfOverrideDivergence` can't catch it (the source name has no entry
  to surface). `createLockfileSource` now throws `EBROKENLOCK` (reason `override-range-drift`)
  when the locked target version no longer satisfies the override range, instead of installing
  stale. Regression test in `installer.test.ts`.

### Added

- **Opt-in eddy fast install (`InstallOptions.resolverUrl` / `prefer`, ADR-0182).** When
  `resolverUrl` is set (env-config only, default OFF) and no covering lockfile already gives the
  zero-network fast path, `install()` POSTs the dep-set to the resolver, verifies the returned
  `EddyBundleV1` (each tarball's bytes against the bundle's integrity — non-disableable,
  mirror-grade trust), pre-seeds the `VfsTarballCache` + writes the lockfile, then the existing
  ADR-0023 fast path installs with **zero packument network**. `prefer: 'online'` is forwarded to
  force a fresh server-side recompute. ANY failure (unreachable, HTTP error, malformed bundle,
  integrity mismatch, lockfile-coverage gap, or a typed `unsupported` decline) → the standard
  verifying install runs (warns, never throws-because-fast-path-down). `InstallResult.source`
  (`'eddy' | 'standard'`) reports which path ran. The determinism walk (`walkAndPin`) is untouched.
- **`EddyBundleV1` codec (`packEddyBundle` / `unpackEddyBundle`) + `parseTarEntries`.** The wire
  format `@riftydev/eddy` produces and the client consumes — a store tar of the manifest +
  lockfile + each original gzip tarball. One format definition, both directions.

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
- **Eddy fast path refuses a non-v3 bundle lockfile.** `tryEddyFastPath` now declines to the
  standard install if the bundle's `package-lock.json` isn't `lockfileVersion: 3`, BEFORE seeding
  the cache or writing the lockfile. A divergent resolver returning a v1/v2 shape no longer
  clobbers the user's lockfile or makes `install()` throw `NotImplementedError` on the post-seed
  re-read — honoring both the never-throw and lockfile-untouched promises (ADR-0182).
- **Eddy decline diagnostic names the feature.** A typed `422` decline now warns
  `resolver declined (<feature>)` instead of the opaque `resolver returned HTTP 422`: the JSON
  decline body is parsed before the `!response.ok` gate that previously shadowed it.

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
- **Builtin esbuild substitution runs before lifecycle gating.** The installer
  applies the exact synthetic recipe without acquiring the native package, so
  its binary `postinstall` never enters the admitted tree. This covers the Vite
  install path used by the Netlify playground smoke. Guard:
  `src/installer.test.ts`.
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
