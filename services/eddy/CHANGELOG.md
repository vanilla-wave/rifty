# Changelog

## [Unreleased]

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
