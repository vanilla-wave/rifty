# ADR 0182: Eddy opt-in fast-install resolver

Status: Accepted
Date: 2026-06

> TL;DR: a new opt-in fast `npm install` path — a published Node service `@riftydev/eddy` runs rifty's OWN resolution server-side and returns one artifact (a v3 lockfile + the bundled compressed tarballs); the client pre-seeds its tarball cache + writes the lockfile, then the existing lockfile fast path installs with one round-trip (~6x cold vs the standard path). Standard install is unchanged and is the always-on fallback.

## Context

Measured cold install (no lockfile) is two latency-bound waterfalls — the packument metadata walk (~2s; graph-depth × RTT, abbreviated packuments cut bytes 2.5x but NOT wall-time) plus the tarball-fetch phase (~1.7-2.2s; the browser coalesces one origin to a single multiplexed h2 connection, so the `FETCH_CONCURRENCY=8` semaphore just queues streams — raising it is inert in-browser, only HTTP/3 might help). ADR-0175 (prefetch) and ADR-0176 (CDN cache) attacked the edges; the structural floor is the depth-sequential metadata walk. Repeat/template installs are already near-optimal (ADR-0023 lockfile fast path, ADR-0135 baked snapshots). The remaining target is the cold, no-lockfile first run on a user-authored `package.json`.

Adversarially verified (express@^4 + eslint@^9, faithful browser transport): standard ~4s; a server that resolves once and bundles the tarballs → ~0.6-0.7s (~6x). Three artifact shapes were measured: lockfile-only (leaves the tarball phase on the client, ~1-2s), lockfile + compressed-tarball bundle (one stream, bytes-bound), lockfile + extracted node_modules (4.3x byte penalty to save ~50ms decompress — strictly dominated). Serverless was already rejected for this traffic (ADR-0163, 2.5-3.5MB response cap); eddy is a streaming Node service, KB-to-MB responses are fine.

## Decision

1. **New package `@riftydev/eddy`** — a Node HTTP service (published to npm + a Docker image, mirroring the Caddy proxy), living at `services/eddy/`. rifty.dev runs it alongside the registry proxy; self-hosters deploy their own. It is OPT-IN; absence changes nothing.
2. **One algorithm (fidelity).** Eddy IMPORTS `@riftydev/npm-client` and runs the SAME resolution + `buildLockfile` + ADR-0051 native gate — never a reimplementation — then fetches and bundles the tarballs. One algorithm ⇒ no lockstep drift; parity = compare eddy's lockfile to a client live-resolve.
3. **Artifact = `EddyBundleV1`** (variant B): a streamed tar containing `package-lock.json` + each `<name>-<version>.tgz` (already gzip; not re-compressed). The extracted-tree variant (C) is rejected (byte penalty). The client UNPACKS the bundle by pre-seeding its `VfsTarballCache` (keyed name@version+integrity) + writing the lockfile to cwd, then runs the EXISTING `install()` → lockfile fast path → zero network. Reuses `extractTarGz` + `link`; minimal new client code.
4. **Public client seam.** `InstallOptions` gains `resolverUrl?: string` + `prefer?: 'cached' | 'online'`, re-exported via `@riftydev/sdk`, so SDK embedders and self-hosters can enable fast mode (not a playground-private feature). Default OFF; the resolver URL comes only from explicit env-config (D-004), never a baked default. The playground sandbox toggle flips the same public seam.
5. **Mirror-grade trust.** The client verifies each tarball's bytes against the integrity carried in eddy's bundle (catches corruption/transport; non-disableable) but NOT against npm's source-of-truth packument (that would re-introduce the metadata waterfall). Fast mode trusts the eddy operator exactly as one trusts a registry mirror (ADR-0163). On ANY failure (unreachable, parse, integrity mismatch, lockfile coverage gap, unsupported spec) the client auto-declines to the standard verifying install. A `trust-model.md` documents the boundary in the loud-throw register; the eddy code path is observable in the install result (provenance).
6. **Bounded staleness.** Eddy caches resolution two-tier: a mutable `dep-set → resolved-closure-hash` lookup (TTL default 30 min, operator-tunable including 0) + an immutable `closure-hash → bundle` artifact (CDN-cacheable, 1y). `prefer: 'online'` forces a fresh recompute (npm `--prefer-online` analogue); the default cached path is the `--prefer-offline` analogue. Every artifact carries an as-of stamp (resolution timestamp + upstream revision) so staleness is visible/auditable, never hidden. This is npm's own metadata-freshness model (max-age + revalidation, lockfile = the determinism mechanism), moved one tier closer to the client.
7. **Templates.** rifty's from-scratch presets pin EXACT versions + ship a committed lockfile, so their `closure-hash` is permanently stable → eddy bundle is a perpetual immutable cache hit. (Instant presets stay on ADR-0135 baked snapshots; eddy serves from-scratch presets + user-authored `package.json`.)

## Consequences

- Cold no-lockfile install drops ~6x (~4s → ~0.6-0.7s, measured) by collapsing BOTH waterfalls into one bundled fetch; the win is a property of the OPEN, auditable stack (self-hostable, MIT) that closed competitors cannot structurally match.
- The standard install path is untouched and stays compatible with a plain thin proxy / real npm; eddy is purely additive.
- New always-on infra + operator surface (the eddy VM/container alongside Caddy) and a new published package to maintain.
- A new trust boundary (mirror-grade) and a bounded-staleness window — both within models already accepted (ADR-0163 proxy trust; npm's own max-age freshness) and both made explicit (trust doc, as-of stamp, prefer-online escape, TTL=0 knob).
- Version skew: eddy and the client both embed npm-client resolution, but the client only REPLAYS eddy's pins (no re-resolve), so skew cannot corrupt an install; a parity CI test pins eddy-closure ≡ client-live-resolve against the current npm-client, and eddy reports its npm-client version.
- **Open validation (gates the perf headline, not the decision):** the ~6x assumes the bundled single-stream beats the per-origin single-h2 tarball phase; HTTP/3 (advertised via alt-svc, untested here) could lift the single-connection ceiling and narrow eddy's edge — a real-browser h3 measurement gates the quoted number.
- Pinned templates rot (no auto patch uptake) → a deliberate re-pin/re-bake cadence is owed.

## Acceptance criteria

- [ ] Parity: eddy's lockfile ≡ a client live-resolve lockfile (versions, `resolved`, `integrity`, installPaths) for express@^4 + eslint@^9; bundle tarball integrities match the lockfile.
- [ ] Client opt-in is default-OFF, env-config only, and auto-declines to standard install on every failure mode named in Decision §5.
- [ ] Bytes-vs-bundle-integrity verification is non-disableable; the eddy path is observable in the install result.
- [ ] As-of stamp present on every artifact; `prefer: 'online'` forces a fresh recompute; TTL is operator-configurable including 0.
- [ ] Native gate (ADR-0051) fires identically on eddy's server-side resolution.

## Reversibility classification

**IRREVERSIBLE** — new published package + new public `@riftydev/npm-client`/`@riftydev/sdk` option + new wire contract (`EddyBundleV1`) + new operator infra; extends ADR-0163. Recorded per record-and-continue.

## Cited ADRs and docs

- ADR-0163 — Yandex Cloud streaming npm-registry proxy (the infra + trust precedent eddy extends).
- ADR-0176 — CDN cache headers (the immutable-artifact + freshness-TTL precedent).
- ADR-0175 — client packument prefetch (the latency-bound waterfall this supersedes for fast mode).
- ADR-0023 — lockfile fast path (eddy's client consumption reuses it verbatim).
- ADR-0135 — baked snapshots (instant presets; the boundary eddy does NOT cross).
- ADR-0051 — native dependency policy (eddy applies the same gate).
- `docs/process/decision-workflow.md` — record-and-continue + confirm-first for outward infra.
- Backlog epic closed 2026-07-07 after the production transport measurement
  and upstream A/B deploy.
