# Changelog

## [Unreleased]

### Added (eddy v1.2, ADR-0194)

- **Shared resolve caches + single-flight.** Cold resolves now share a process-wide
  packument cache (TTL `EDDY_PACKUMENT_TTL_SECONDS`, default 300s = npmjs edge
  `max-age`; `prefer:'online'` bypasses reads, writes through) and a byte-bounded
  immutable tarball cache (`EDDY_TARBALL_CACHE_MAX_BYTES`) layered under a
  per-request view — an unseen-but-overlapping dep set refetches only its novel
  packages, and a mutable-TTL recompute re-packs tarballs without re-downloading.
  Concurrent identical dep-sets single-flight into one compute.
- **`BundleStore` — stateless-restartable origin.** The immutable
  `closure-hash → bundle` tier moved out of the entry-capped in-process LRU into a
  store abstraction: `MemoryBundleStore` (byte-bounded LRU,
  `EDDY_BUNDLE_MEMORY_MAX_BYTES`; local/test default) or `S3BundleStore`
  (`EDDY_S3_*` env group, all-or-none — partial config refuses to boot). A cold
  POST awaits the store put BEFORE linking (durable-before-link); a failed put
  logs, skips the link and still serves the bundle. S3 reads are plain fetches
  against the public-read bucket; only PUT is signed — hand-rolled SigV4
  regression-locked to the published AWS example vectors, no SDK dependency.
  Object key `bundle/<hash>` (RAW base64) keeps the client's `bundleUrlFor`
  working unchanged when the CDN origin re-points to the bucket.
- **GET route hardened.** `GET /bundle/<hash>` with a failing store answers
  `500` JSON instead of dying on an unhandled rejection.

### Fixed (eddy v1.2 review follow-ups, ADR-0194)

- **`S3BundleStore.put` proves PUBLIC readability before settling.** The signed
  PUT succeeding says nothing about the unsigned read path (the CDN + clients
  read unsigned): against a private/mis-ACL'd bucket the put settled, the cache
  linked the hash, and every GET-by-hash 403'd. After the PUT an unsigned HEAD
  must now return ok with the body's ETag — else `put` throws ("is the bucket
  public-read?") and the cache's degrade path skips the link. Regression: a
  fake S3 that accepts writes but 403s public reads.
- **A throwing store read on a fresh mutable link degrades to recompute — the
  POST never 500s while the registry is up.** `resolve()` called `store.get()`
  bare on a link hit; an S3 outage propagated as a 500 even though the POST has
  the dep-set and could recompute. The read failure now logs and reads as a
  miss (→ compute → the existing failed-put degrade). The direct
  `GET /bundle/<hash>` route (no dep-set to recompute from) still surfaces the
  error.
- **Store read validation is now at least as strict as CLIENT adoption.**
  `verifyContentAddress` only verified tarballs the manifest NAMED — a poisoned
  object keeping its lockfile (same closure hash) while omitting a reachable
  tarball from BOTH manifest and members read as a store HIT that every browser
  client bounces via its completeness gate (permanent decline loop until the
  mutable TTL expired). The store now runs the SAME `bundleCompletenessGap`
  (roots = the lockfile root entry's deps — the original request), so such an
  object reads as a miss and self-heals on the next compute's put.
- **`parseS3Config` refuses junk, not just absence.** Whitespace-only values
  passed the all-or-none presence check and booted the S3 store with blanks;
  values are now trimmed (blank = missing), the endpoint must be an http(s)
  URL, bucket/region must not contain whitespace — all named-var errors, never
  echoing the secret pair.
- **`MemoryBundleStore.put` is durable-or-THROW — an over-cap bundle no longer
  publishes an unservable hash.** The silent over-cap `return` let `EddyCache`
  believe the put succeeded: it wrote the mutable link, but `GET /bundle/<hash>`
  404'd forever — every "linked" resolve of that dep set degraded to a full
  recompute with a misleading link. `put` now throws; the existing degrade path
  (log, skip link, serve the computed bundle) handles it, so the hash is never
  published unservable. Pinned by a store-level rejects test + an
  `EddyCache`-level unservable-hash test (`bundle-store.test.ts`), both
  RED-checked against the silent drop.
- **`BundleStore` self-heals a poisoned key.** The `has()`-gate that skipped the
  durable-before-link put whenever an object *existed* could never overwrite a
  corrupt/foreign/truncated object (a HEAD-exists check can't tell it from a valid
  one), so a poisoned `bundle/<hash>` stayed a permanent GET-by-hash `404`. Dropped
  `BundleStore.has`; `put` is now the idempotent self-healing primitive — the cache
  puts unconditionally, and `S3BundleStore.put` HEADs first and skips the upload
  ONLY when the object's ETag (single-part MD5) matches the bytes, otherwise
  (re-)uploads. A cold recompute is still a no-op upload; a poisoned key gets fixed.
- **Full content-address verification on read.** `S3BundleStore.get(hash)` no
  longer trusts the manifest's self-reported hash: a HIT must (1) self-report the
  key, (2) RE-DERIVE the key from its own lockfile (`closureHashOf`), and (3) carry
  tarball bytes matching the integrity the manifest names. A forged/poisoned object
  (matching key, tampered lockfile or tarball) now reads as a MISS → `put()`
  re-seeds it, instead of lingering as a permanent store hit the client only
  rejects later.
- **Generation guard across BOTH mutable tiers (freshness race).** Each compute
  carries a monotonic gen. The mutable `dep-set → closure-hash` link AND every
  shared packument write-through (`TtlPackumentCache.setWithGen`) are stamped with
  it, so an older cached-policy compute finishing AFTER a fresh `prefer:'online'`
  refresh can no longer roll back either the link OR the shared metadata cache with
  its stale reads. The immutable tarball cache needs no guard (same key ⇒ same bytes).
- **Immutable `Cache-Control` on the S3 PUT + metadata self-heal.** The signed PUT
  sends `cache-control: public, max-age=31536000, immutable`, so a bucket-backed CDN
  origin serves bundles with the same forever-cacheable header as the origin GET
  route (was absent). `put`'s skip-identical fast path now also checks the header:
  a same-byte object missing it (an older upload) is re-PUT to repair the metadata.
- **`closureHashOf` canonicalization moved to `@riftydev/npm-client`; the
  `@riftydev/eddy` API is UNCHANGED.** The shared async (WebCrypto)
  implementation is what the resolver awaits and the client re-derives to
  verify a bundle's self-claimed hash. `@riftydev/eddy` keeps its pre-existing
  SYNC `closureHashOf(lockfile): string` (node:crypto over the SAME exported
  `canonicalClosureJson` — a drift-tripwire test asserts sync === await async),
  so existing consumers see no signature change.
- **Deploy compose cosmetics.** `docker-compose(.coi).yml` Caddyfile heredoc indents
  with spaces (was space-before-tab → `git diff --check` noise); the CDN-origin
  comment cites ADR-0195 (the renumbered wire-v1.1 ADR), not the stale ADR-0186.
- **Deploy honesty: S3 env + HTTP/3 ports.** The committed COI compose boots the
  MEMORY bundle store — the stateless-origin story needed the operator's
  `EDDY_S3_*` env, which the docs implied was live. The compose now carries
  commented placeholders + the secret-injection workflow (local copy →
  `--metadata-from-file`; never committed), and `hosting-eddy.md` states the
  live deploy is memory-backed until that step. Both composes also publish
  `443/udp` for HTTP/3, and the docs/backlog now say plainly: the reused
  security group is TCP-only, so h3 is NOT reachable until an operator adds a
  `443/udp` ingress rule — no h3 number is quotable before then.

### Added

- **`GET /bundle/<closureHash>` (ADR-0195).** Content-addressed immutable-tier lookup serving
  the exact bundle bytes with `Cache-Control: public, max-age=31536000, immutable` — the header
  is now load-bearing (a fronting CDN and the browser HTTP cache hold bundles forever). A miss
  (LRU eviction, restart) is `404` + `no-store`; the client's POST fallback re-seeds the tier.
  CORS methods now advertise GET; `access-control-allow-headers: content-type` kept for older
  preflighting clients.

### Deploy

- **Cross-platform image build.** The Dockerfile's build stage is pinned to
  `--platform=$BUILDPLATFORM` (the artifact is a self-contained JS bundle), so
  an Apple-Silicon `docker buildx build --platform linux/amd64 --push` runs at
  native speed instead of QEMU-emulating pnpm/tsup. rifty.dev runs `eddy:0.2.1`
  behind the split-host CDN shape (`hosting-eddy.md` §CDN tier).

### Fixed

- **Oversized request body → `413` JSON, not a torn socket.** A POST over
  `MAX_BODY_BYTES` now replies with `413 {error:'request body too large'}` and
  DRAINS (discards) the rest of the upload rather than destroying the socket —
  the old `req.destroy()` reset the connection (client saw `ECONNRESET`;
  destroying after the reply instead would race the still-arriving upload →
  `EPIPE`). Memory stays bounded (nothing is buffered past the cap).
- **`EDDY_TTL_SECONDS` validated at startup (`parseTtlSeconds`).** A junk value
  (`abc`, `30s`) now throws loudly instead of coercing to `NaN` and silently
  killing the mutable-tier cache (every request recomputed). A whitespace-only
  value (`" "`, `"\t"`) is also refused — `Number(" ")` is `0`, not `NaN`, so it
  would otherwise slip past the finite/≥0 gate and silently set TTL 0 (dead
  cache). `0` (always recompute) and unset (default TTL) are unchanged.

### Added

- **Eddy fast-install resolver service (`@riftydev/eddy`, ADR-0182).** Runs
  rifty's OWN resolution server-side — IMPORTS `@riftydev/npm-client` and calls
  `install()` into an in-memory VFS, then harvests the v3 lockfile + the
  compressed tarballs it cached into one `EddyBundleV1` (`resolveBundle`). ONE
  algorithm ⇒ the bundle's lockfile equals a client live-resolve by
  construction; the ADR-0051 native gate and the non-registry-spec loud-throws
  ride for free (caught → a typed `{ kind: 'unsupported' }` decline, never a
  synthesized result).
- **Two-tier cache (`EddyCache`).** Mutable `dep-set → closure-hash` (TTL
  default 1800s, operator-set, `0` = always recompute) + immutable
  `closure-hash → bundle` (content-addressed, served with
  `Cache-Control: immutable`). `prefer: 'online'` bypasses the mutable tier.
- **HTTP server (`createEddyServer`) + `npx @riftydev/eddy` CLI.** POST a
  dep-set → a streamed `EddyBundleV1` with the as-of stamp in `x-eddy-*`
  headers, or a `422` typed decline for unsupported specs. Config via env
  (`PORT`, `REGISTRY_BASE_URL`, `EDDY_TTL_SECONDS`). Serves permissive CORS +
  `Cross-Origin-Resource-Policy: cross-origin` and answers the `OPTIONS`
  preflight (204) so the COEP-isolated browser client can fetch it cross-origin
  (the JSON POST is non-simple → preflighted); `x-eddy-*` are exposed.
- **Deploy recipe fronts eddy with Caddy for HTTPS.** `deploy/yandex/eddy/
  docker-compose.yml` adds a Caddy sidecar terminating TLS for `eddy.rifty.dev`
  → `eddy:8788`, mirroring the ADR-0163 proxy; eddy's cross-origin headers pass
  through. See `docs/public/hosting-eddy.md`.
- **Self-contained build.** `tsup` now bundles the `@riftydev/*` deps INTO
  `dist` (they move to `devDependencies`), so `node dist/bin.js` — the Docker
  image and `npx @riftydev/eddy` — needs no `node_modules`. This removes a
  broken-deploy hazard: `pnpm deploy` does not apply `publishConfig`, so an
  externalized `@riftydev/*` resolved to its TS source and crashed at runtime.
  The Dockerfile drops `pnpm deploy` (copies just `dist`) and skips the
  Playwright browser download.
- **COI deploy documented + `.dockerignore`.** A Container-Optimized-Image VM
  PULLS images (it can't build the compose `build:` context), so
  `docs/public/hosting-eddy.md` covers build+push to a registry + the VM puller
  service account; a root `.dockerignore` keeps host `node_modules`/`.git` out
  of the build context. The image was verified to build + serve (CORS preflight
  204) from a clean `docker build` + `docker run`.
- **Deployed at `https://eddy.rifty.dev`** (Yandex COI VM + Caddy TLS; image
  `cr.yandex/<reg>/eddy:0.1.0`, linux/amd64). `VITE_RIFTY_RESOLVER_URL` wired
  into the playground prod build (`netlify.toml`); `tools/eddy/smoke-eddy.mjs`
  guards it in CI (`netlify.yml`); resources recorded in
  `docs/public/hosting-yandex.md`. Live smoke: POST → 200 bundle (debug→ms
  diamond) with CORS + `x-eddy-*`.
- **Skew-audit version fix.** The self-contained bundle inlines
  `@riftydev/npm-client`, so the runtime `require.resolve` for the
  `x-eddy-npm-client-version` header always returned `unknown`; tsup now injects
  the version at build time (`define`), with the runtime resolve as the dev
  fallback.
- **Publish-set wiring.** eddy joins `build:libs` (so its `dist/` builds in the
  publish pipeline) and `first-publish.sh`, which gains a `--only <filter>` mode
  to bootstrap a single new name (`--only @riftydev/eddy`) without re-publishing
  the existing 12. `release.yml`'s automated set adds eddy after that bootstrap
  (OIDC can't create a name) — see `docs/public/publishing.md`.
