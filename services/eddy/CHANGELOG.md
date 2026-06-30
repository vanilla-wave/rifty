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
- **Publish-set wiring.** eddy joins `build:libs` (so its `dist/` builds in the
  publish pipeline) and `first-publish.sh`, which gains a `--only <filter>` mode
  to bootstrap a single new name (`--only @riftydev/eddy`) without re-publishing
  the existing 12. `release.yml`'s automated set adds eddy after that bootstrap
  (OIDC can't create a name) — see `docs/public/publishing.md`.
