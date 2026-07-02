# ADR 0194: eddy v1.2 — stateless bundle store, shared resolve caches, learned pins

Status: Accepted
Date: 2026-07

> TL;DR: eddy's origin becomes stateless-restartable — bundles live in a `BundleStore` (byte-bounded memory LRU locally, S3-compatible Object Storage behind the CDN in prod) written durably BEFORE the dep-set link; cold resolves share process-wide packument (TTL 300s) + tarball (immutable, byte-bounded) caches with single-flight per dep-set; the client returns `InstallResult.closureHash` so the playground can persist learned `requestKey → closureHash` pins and turn ANY repeat dep set into a cacheable GET.

## Context

Measured 2026-07-02 (install-only, express+eslint, 137 pkgs): eddy warm POST 0.88s (8.1× vs standard), but COLD-origin POST 17.3s — worse than the warm standard path (7.1s). Anatomy: the server runs `install()` with per-request caches (fresh `MemoryVfs`, fresh packument map), so every unseen dep set refetches everything; the walk is graph-depth-bound (concurrency inert, corgi bytes-only). Separately, the in-process immutable LRU (256 × 3–7MB) risks ~1.5GB RSS, dies on every deploy/restart, and pins GET traffic to the VM; pins today are env-config per TEMPLATE only, so arbitrary `npm install` sets always POST the origin. Backlog contracts: `perf/eddy-cold-origin-resolve-floor`, `npm-client/eddy-learned-pins`.

## Decision

Server (`services/eddy`):

1. **Shared packument cache** — process-wide, TTL **300s** (= npmjs `max-age=300`; env `EDDY_PACKUMENT_TTL_SECONDS`, 0 = off), entry-bounded LRU. `prefer:'online'` bypasses reads (npm `--prefer-online` forces staleness checks) but writes through (refresh). Freshness contract unchanged: a mutable-tier recompute (TTL 1800s) resolves against packuments at most 300s old — same observable freshness class as any registry edge (npmjs itself serves `max-age=300`).
2. **Shared tarball cache** — process-wide, byte-bounded LRU (env `EDDY_TARBALL_CACHE_MAX_BYTES`), keyed (name, version, integrity) = immutable, verified on read. Layered per-request: resolve reads through local→shared, writes through to both — harvest always finds this request's bytes locally, evictions can't corrupt a resolve. This SUBSUMES the "resolve-only TTL refresh" lever: a TTL recompute refetches packuments only; unchanged closures re-pack from cached tarballs.
3. **Single-flight** per `depSetKey` in `EddyCache.resolve` — concurrent identical requests join one compute (thundering herd). `prefer:'online'` never JOINS an existing flight (it may read TTL-cached packuments); its own fresh compute registers and is joinable (fresher than required).
4. **`BundleStore`** replaces the in-process immutable LRU: `get/has/put` by closureHash. `MemoryBundleStore` — byte-bounded LRU (env `EDDY_BUNDLE_MEMORY_MAX_BYTES`), default for local/tests. `S3BundleStore` — env-gated (`EDDY_S3_ENDPOINT/BUCKET/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY`, all-or-none, partial config throws at boot): GET/HEAD hit the public-read bucket via plain `fetch`; PUT is hand-rolled SigV4 (PUT-path only, no new deps; regression-tested against the published AWS SigV4 S3 example vector). Object key = `bundle/<closureHash>` with the hash RAW (base64 `/` `=` as-is): the client's `bundleUrlFor` percent-encodes and S3 percent-decodes the path, so re-pointing the CDN origin from the VM to the bucket needs zero wire/client change. Manifest is recovered from the bundle bytes on `get` (it IS the first tar member) — no sidecar metadata.
5. **Durable-before-link**: a cold POST `await`s `store.put()` before writing the mutable link and responding (~150ms on a multi-second cold path); a hash already `has()` in the store skips the put. A failed put logs loudly, skips the link, and still serves the computed bundle — degraded to recompute-next-time, never a 500. Origin state (mutable links, packument/tarball caches) is reconstructible RAM only → restarts/deploys lose nothing durable, hosts scale without shared disk or sticky routing.

Client (`packages/npm-client`):

6. **`InstallResult.closureHash?: string`** — set iff `source === 'eddy'`, the adopted bundle's `manifest.asOf.closureHash`. (`consumeEddyResponse` returns `{adopted: true, closureHash} | decline-string`; `tryEddyFastPath` returns `string | null`.) Public-API addition; optional, so existing result literals stay valid.
7. **`InstallOptions.packumentCache` widened** from `Map<string, Packument>` to a minimal `{get, set}` interface (`PackumentCacheLike`) so eddy can inject its TTL cache; `Map` satisfies it structurally — no caller changes.

Playground (`apps/playground`):

8. **Learned pins** — `/.rifty/eddy-learned-pins.json` (dot-dir precedent: `VfsTarballCache`), `requestKey → {closureHash, savedAt}`, TTL **1800s** (= server mutable default — a pin must not outlive the server-side link it mirrors), cap 64 (evict oldest), corrupt/missing = absent (never an error). Async (Vfs) + sync (`FsSync`) readers — sync because `primeInstallPrefetch` is sync by design (async gate = measured double-POST). `requestKey = canonicalEddyRequestKey(eddyRequestFromPackageJson(text))` computed AFTER the merged package.json write; learned entries exist only under the `prefer:'cached'` key. Env pin (`VITE_RIFTY_EDDY_PINS`) has priority; write-back after an eddy install is fire-and-forget. New seam: `NpmShellCommandDeps.learnedPins?: {get; set}`.

Revisits ADR-0186's rejected alternative "client-persisted dep-set→hash map": the install stamp suppresses repeat installs on the SAME tree, but a fresh profile/new project with a known dep set has no stamp — measured 2026-07-02, that path is a full origin POST (~0.65s of 0.88s is TLS+RTT+origin transfer) vs ~0 for a browser-HTTP-cache GET.

Rejected: VM disk / RAM-only LRU as the bundle store (deploy invalidates, RSS-bounded, sticky GET traffic — evolution recorded in the closed backlog item); new S3 SDK dep (one signed PUT doesn't justify a dependency tree); walk-concurrency bump (measured −10% at 8→32, depth-bound); separate resolve-only wire mode (subsumed by shared tarball cache, see 2).

## Consequences

- Cold-origin resolve for overlapping sets collapses toward tarball-fetch time; identical warm sets stay one store/link lookup; concurrent cold storms compute once.
- Origin is disposable: bundles survive restarts in the bucket, CDN serves GET bytes, VM egress drops. Known trade (measured 2026-07-01): CDN GET +0.8s vs direct origin from EU — offload + durability, not latency everywhere.
- Any repeat dep set (not just pinned templates) becomes a CDN/browser-cacheable GET on the next fresh profile; stale learned pins degrade to POST through the existing verification gates, never to a wrong install.
- Corrupt/missing bucket object self-heals: client verify fails → POST → re-seed.
- Ops: bucket + SA keys + public-read + CDN origin re-point are operator steps (`docs/public/hosting-eddy.md`); 404-caching must stay off at the edge.
