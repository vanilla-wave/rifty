# ADR 0195: Eddy wire protocol v1.1 — GET-by-hash, CORS-simple POST, streaming client, prefetch seam

Status: Accepted
Date: 2026-07

> TL;DR: eddy grows a cacheable `GET /bundle/<closureHash>`; the client kills the CORS preflight, streams the bundle, tries prefetch → pinned GET → POST (first survivor wins), and exposes `startEddyPrefetch` + `resolverClosureHash`/`resolverPrefetch` so the round-trip overlaps boot.

## Context

Profiled 2026-07-01: eddy's install-only median (~1050ms) is ≈ the POST round-trip itself (~1060ms; client extraction ~77ms). The POST is uncacheable (shared caches never store POST), preflighted (JSON content-type → extra RTT), fully buffered on both ends, and starts only when `npm install` runs — serialized after boot. ADR-0182 §6 named an immutable `closure-hash → bundle` CDN tier but only the in-process LRU existed (`distribution/eddy-cdn-tier-get-by-hash`).

## Decision

1. **`GET /bundle/<closureHash>`** (hash percent-encoded — `sha256-<base64>` carries `/`): immutable-tier lookup, 200 with the exact POST-200 headers (`immutable` now load-bearing: browser HTTP cache + any fronting CDN hold content-addressed bytes forever), 404 JSON `no-store` on a miss (a CDN must never pin a miss). No server-side re-resolve on miss — the hash is not invertible; the client's POST fallback re-seeds the tier (self-healing after restart/eviction).
2. **CORS-simple POST**: client sends NO `content-type` header (string body → `text/plain` → no preflight, −1 RTT cold). Server always parsed the body unconditionally; `access-control-allow-headers: content-type` kept for already-deployed clients. GET is preflight-free by construction.
3. **Streaming client**: `tryEddyFastPath` consumes the bundle via `streamTarEntries` (member order `manifest → lockfile → tarballs/*` is the bundle contract). Format/v3/coverage/divergence gates run on the first two members — a decline cancels the download before tarball bytes transfer. Tarballs are integrity-verified (non-disableable, ADR-0182 §5) and seeded into the content-addressed cache AS EACH ARRIVES — partial seed leaves only verified bytes (cache re-verifies on `get`); the lockfile is still written ONLY after every manifest-named tarball landed. Buffered fallback when `Response.body` is unavailable.
4. **Attempt pipeline + public API**: `InstallOptions.resolverClosureHash` (pinned GET first) and `InstallOptions.resolverPrefetch` (+ exported `startEddyPrefetch`, `eddyRequestFromPackageJson`, `canonicalEddyRequestKey`, `bundleUrlFor`). Attempts: prefetched response → pinned GET → POST; every attempt passes the same gates; all failures warn-and-fallback to the standard verifying install. A prefetch is keyed on the canonical request (incl. `prefer`) and consumed at most once — a stale prefetch is ignored, never trusted. `InstallOptions.resolverBundleBaseUrl` (default `resolverUrl`) lets the pinned GET ride a separate CDN hostname: verified live 2026-07-01 — Yandex CDN (`ourcdn`) refuses POST at the edge (405, method not manageable), so the split-host shape `eddy.rifty.dev` (origin, POST) + `eddy-cdn.rifty.dev` (edge, GET-by-hash) is the deploy reality, not an option.
5. **Preset pins channel**: `VITE_RIFTY_EDDY_PINS` (JSON `preset-id → closureHash`, env-config per D-004, default absent). Operator workflow + re-pin cadence: `docs/public/hosting-eddy.md`. No per-preset UI toggle — env-config is the operator switch; a user-facing mode adds no user value today.

Alternatives rejected: POST-302→GET (extra RTT every cold resolve); client-persisted dep-set→hash map (whenever it would exist, an install stamp already suppresses the install); re-resolve-on-GET-miss (hash not invertible).

## Consequences

- Pinned presets: bundle fetch = one preflight-free edge/browser-cache-able GET; repeat visits hit the browser HTTP cache (0 network). CDN can front eddy with zero further server work.
- Decline paths get cheaper (abort before tarball transfer) and slow-network installs overlap transfer with hash+seed.
- Stale pins/prefetches degrade to POST — never to a wrong install (same non-disableable gates on every path).
- Wire format unchanged (`EddyBundleV1`); old servers (405 on GET) and old clients (preflighted POST) interop with new counterparts.
- Follow-up: actually front eddy.rifty.dev with a CDN + set pins in deploy env (`distribution/eddy-package-and-deploy`).
