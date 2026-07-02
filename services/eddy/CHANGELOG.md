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
- **Honest caching docs.** `hosting-eddy.md` + the server comment no longer
  claim a live CDN tier: the `Cache-Control: immutable` header is inert on the
  POST resolve response (shared caches don't store POST), so today only the
  in-process LRU is the shared cache. A real CDN tier needs a
  `GET /bundle/<closure-hash>` route — tracked in
  `docs/backlog/distribution/eddy-cdn-tier-get-by-hash.md`.

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
