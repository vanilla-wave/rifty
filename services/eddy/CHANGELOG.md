# Changelog

## [Unreleased]

### Fixed (PR #107 round 19)

- **405 `Allow` header advertises OPTIONS.** OPTIONS is handled (the CORS
  preflight branch) so it now appears in `Allow` alongside `GET, HEAD, POST` —
  matching `access-control-allow-methods` (RFC 9110: 405 advertises the
  resource's methods).

### Fixed (PR #107 round 18)

- **Store rejects a DUPLICATE tarball member.** A poisoned object naming the same
  tarball file twice (good bytes then bad) passed the round-16 sequence gate
  (both occurrences are manifest-named): `unpackEddyBundle`'s by-name map verified
  the good one as a HIT while the positional streaming client read the bad one and
  declined — a permanent hit self-heal never cleared. The post-lockfile member
  loop now enforces uniqueness.
- **Immutable store write is byte-stable under transient reads + same-hash races.**
  A transient store-read error is no longer treated as a miss (which would PUT
  fresh-`resolvedAt` bytes over a possibly-valid object); the compute degrades
  without overwriting. Concurrent computes of the SAME closure now serialize per
  hash, so the second serves the first's stored artifact instead of racing a
  second PUT (ADR-0194 §5).

### Fixed (PR #107 round 17)

- **`EDDY_S3_ENDPOINT` requires HTTPS.** Signed SigV4 PUTs carry an
  `Authorization` header cleartext HTTP would expose to a network MITM; a plain
  `http://` endpoint now throws at startup (loopback hosts stay allowed as a
  local mock-S3 test seam).
- **405 responses advertise an `Allow` header** (`GET, HEAD, POST`, RFC 9110).

### Fixed (PR #107 round 16)

- **Store validates the raw member SEQUENCE.** `manifest → lockfile →
  manifest-named tarballs` — a poisoned object with a DUPLICATE reserved
  member (`unpackEddyBundle`'s by-name map keeps the last, the streaming
  client reads the first and declines) or a malformed-but-parseable manifest
  (missing `asOf`) now reads as a MISS (self-heal), never a store hit strict
  clients bounce or a direct-GET 500.
- **Every JSON reply is `no-store`.** POST errors/declines (malformed JSON,
  validation 400s, resolver 500s, 422) are body-dependent — a URL-keyed
  proxy/CDN must never pin them (success POST was already `no-store`).
- **`EDDY_S3_BUCKET`/`REGION` shape-gated at startup.** `urlFor` interpolates
  the bucket raw into the request path — `/`, `\` or dot segments would
  silently address nested/normalized paths; refused loudly now (conservative
  S3 name subset).

### Fixed (PR #107 round 15)

- **Immutable GET bytes are byte-STABLE under a closure hash.** The hash
  addresses the lockfile closure, not the tar bytes — a recompute packed a
  fresh `asOf.resolvedAt` and OVERWROTE the stored object, so the
  one-year-`immutable` `/bundle/<hash>` URL could serve different bytes than
  a browser/CDN already held. A recompute of an already-stored closure now
  serves the VERIFIED stored artifact as-is (original as-of stamp, per the
  recorded staleness-visible contract) and puts only on a miss/poisoned key
  (the verified `get` still reads corrupt objects as misses — self-heal
  intact).
- **`/bundle/<hash>` routes a RAW base64 slash to the validator.** The
  one-segment route regex 405'd a valid hash a proxy/raw client forwarded
  decoded; the shape gate is the validator, junk still 400s.

### Fixed (PR #107 round 14)

- **POST body validation is loud.** Malformed dependency fields (a string, an
  array, nested/alias objects) used to be silently FILTERED — the remainder
  resolved as a happy-path bundle for an empty/partial closure. Every present
  `dependencies`/`devDependencies`/`optionalDependencies`/`overrides` must now
  be an object of string ranges and `prefer` one of `'online' | 'cached'`;
  anything else is a `400` naming the offending field (matching the client's
  own loud package.json reader).

### Fixed (PR #107 round 13)

- **POST success responses are `no-store`.** The response depends on the
  BODY — a URL-keyed cache (some CDNs can be configured to cache POST) would
  serve one dep-set's bundle for another. Only the content-addressed
  `GET /bundle/<hash>` keeps the one-year `immutable` policy.
- **`HEAD /bundle/<hash>` is supported** (RFC 9110: GET minus the body) —
  edge health checks and `curl -I` smoke tests probe the CDN-fronted route;
  it used to 405.
- **Store validation rejects UNEXPECTED extra bundle members** — the same
  shape client adoption declines (`unexpected bundle member`); a smuggled
  member could otherwise stay a permanent store hit strict clients bounce.

### Fixed (PR #107 round 12)

- **`GET /bundle/<hash>` validates the hash shape.** The decoded segment
  becomes an S3 object-key path segment — junk like `..` (sent
  percent-encoded) URL-normalizes into non-bundle bucket paths. Anything that
  is not `sha256-<base64>` is now a `400` with `no-store` (as is malformed
  percent-encoding, previously a 500); the store is never consulted.
- **Error-body snippet cap no longer buffers a whole oversized chunk.** The
  PUT-failure snippet reader slices each chunk to the remaining 4 KiB cap
  instead of pushing it whole.

### Fixed (PR #107 round 11)

- **A fresher compute whose store put fails now KILLS the stale mutable
  link.** "Failed put skips the link" was not enough when an older link
  already existed for the dep-set: it outlived the fresh compute, so a later
  cached request served the STALE closure from the store instead of
  recomputing. The kill rides the same generation guard as the publish — an
  older failed compute never tears down a link a newer refresh published.

### Fixed (PR #107 round 10)

- **S3 store network ops are bounded.** Every `S3BundleStore` fetch (GET, HEAD
  probe, PUT, put proof) runs under a per-op deadline (`opTimeoutMs`, default
  30s) with an `AbortController` + race (a signal-ignoring fetch or a
  stalled/endless body still settles), and body reads are capped
  (`maxBundleBytes`, default = the client's 128 MiB bundle cap). A stalled
  bucket now fails loudly into the existing degrade paths (POST recomputes,
  GET-by-hash 500s) instead of parking the server.
- **Put proof requires the immutable metadata.** The post-PUT public-read proof
  now also checks `Cache-Control: public, max-age=31536000, immutable` on the
  served object — a provider/proxy that accepts the PUT but strips the header
  fails `put()`, so no mutable link is published for a hash the CDN/browser
  tier can't hold.
- **`GET /bundle/<hash>` store-failure 500 is `no-store`.** The route is
  CDN-fronted; a transient bucket outage must never be pinned by an
  intermediary (misses already were `no-store`).
- **`PORT` refuses junk; listen failures exit nonzero.** `parsePort` joins the
  loud env parsers (integer 1..65535; `PORT=abc`/whitespace throw at startup),
  and `EddyServer.listen` rejects on `EADDRINUSE`/`EACCES` so the bin logs and
  exits 1 instead of an uncaught `'error'` event.

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

- **Store read gates match CLIENT adoption exactly: non-v3 lockfiles and
  duplicate manifest members read as a miss.** The closure hash canonicalizes
  `packages` only, so a v1/v2-mutated lockfile still re-derived to the key and
  served as a hit every client bounces (decline loop until the mutable TTL);
  duplicate `file` entries are the client-declined partial shape. Both now
  self-heal via the next compute's put. RED-checked.
- **S3 put proof works on providers with non-MD5 ETags.** The round-8 proof
  required the public HEAD's ETag to equal the body MD5 — bucket encryption /
  multipart / provider-specific ETags would fail a perfectly served object
  forever (recompute loop). An unmatched ETag now degrades to an unsigned GET
  + sha256 byte compare; only a genuinely unreadable/foreign object throws.
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
