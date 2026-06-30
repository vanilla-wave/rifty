---
kind: epic
status: ready
title: Eddy — opt-in fast npm install (~6x cold)
created: 2026-06-28
value: A developer running a cold `npm install` on a real project in a browser tab gets it in well under a second — the same real Node dependency tree, just resolved + bundled by an open, self-hostable server instead of a dozen serial round-trips.
user_story: As a developer (or an SDK embedder building their own sandbox) I want a cold, no-lockfile `npm install` to finish in ~0.6s instead of ~4s, but today it pays two latency-bound waterfalls (packument metadata + many small tarballs) that no client-side knob can remove.
items: [npm-client/eddy-resolver-service, npm-client/eddy-client-opt-in, playground/eddy-from-scratch-presets, perf/eddy-http3-cold-validation, distribution/eddy-package-and-deploy]
---

## Outcome

Cold no-lockfile install is two latency-bound waterfalls — the packument metadata walk (~2s; graph-depth × RTT) and the tarball-fetch phase (~1.7-2.2s; the browser coalesces one origin to a single multiplexed h2 connection, so raising the fetch semaphore is inert). Neither is fixable client-side. `eddy` (`@riftydev/eddy`) is an OPT-IN server that runs rifty's OWN resolution (imports `@riftydev/npm-client` — one algorithm, no drift) and returns ONE artifact: a v3 lockfile + the bundled compressed tarballs. The client pre-seeds its tarball cache + writes the lockfile, then the EXISTING lockfile fast path installs in one round-trip — measured ~6x (~4s → ~0.6-0.7s). The standard install stays untouched and is the always-on verifying fallback. Mission anchor: faster real Node in the browser, where the speed is a property of the OPEN, auditable, self-hostable stack — not a closed vendor turbo button. Full decision record: ADR-0182.

## User scenario

A developer opens a from-scratch preset (or types their own `package.json`), runs `npm install` with fast mode on (a sandbox toggle, or `resolverUrl` set via env-config), and it completes in ~0.6s — real `package@version` lines, a working preview — while the resulting `node_modules` (versions, integrity, layout, lockfile) is byte-identical to what a standard `npm install` / lockfile replay produces (parity-proven). A self-hoster deploys their own eddy (npm or Docker) next to their registry proxy and their users get the same speed, fully offline-capable and auditable. If eddy is absent, unreachable, or returns anything that fails integrity/coverage, the standard verifying install runs instead — the user never gets a wrong or failed install because the fast path was down. Done when fast mode ships parity-gated behind a public opt-in (default OFF), the trust boundary + bounded-staleness are documented, and a real-browser HTTP/3 measurement confirms the headline number.

## Items

- `npm-client/eddy-resolver-service` — the `@riftydev/eddy` Node service: resolve (reuse npm-client) → `EddyBundleV1` (lockfile + compressed tarballs) + two-tier cache + as-of stamp + `prefer-online`. The engine. (ready)
- `npm-client/eddy-client-opt-in` — the public `InstallOptions.resolverUrl`/`prefer` seam (SDK re-export): fetch bundle → pre-seed cache + write lockfile → existing fast path; default OFF, env-config, mirror-grade trust, auto-fallback. (ready)
- `playground/eddy-from-scratch-presets` — wire from-scratch presets to fast mode: exact-version pins + committed lockfiles (perpetual cache hit) + the sandbox toggle + a re-pin/re-bake cadence. (draft)
- `perf/eddy-http3-cold-validation` — the open risk: a real-browser HTTP/3 cold-install measurement that gates the quoted ~6x (built on `perf/cold-start-and-install-benchmark`). (draft)
- `distribution/eddy-package-and-deploy` — publish `@riftydev/eddy` (npm + Docker image), deploy on rifty.dev alongside the Caddy proxy, self-host docs. (draft)

Supersedes (folded from the `cold-npm-install-speedup` epic): the former `npm-client/server-side-closure-resolver` and `npm-client/bundled-popular-subgraph-metadata` draft items — their measured-and-verified design is now this epic + ADR-0182. Out of scope: the extracted-tree artifact variant (4.3x byte penalty, dominated); signed/attested manifests (mirror-grade only for v1); a pluggable client `ClosureSource` (URL seam only for v1); independent npm source-of-truth re-verification (would re-introduce the waterfall).
