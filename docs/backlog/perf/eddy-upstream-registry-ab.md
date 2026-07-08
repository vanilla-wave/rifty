---
area: perf
status: ready
title: eddy upstream registry A/B — direct npmjs vs CDN-proxy, measured on the VM
created: 2026-07-03
why: eddy's cold-origin resolve is RTT-chain-bound (walk is graph-depth-bound; concurrency + bytes already exhausted in v1.2), and the ONE untried server-side lever is the upstream it resolves against — today the deployed VM points `REGISTRY_BASE_URL` at the CDN registry-proxy (built for BROWSER CORS, which the server does not need), paying cold-edge double hops direct npmjs might avoid; this is the lever ADR-0194 §Deferred records
user_story: As a playground user typing a first-ever `npm install <deps>` I want eddy's cold resolve to take the shortest upstream path, but today it resolves through the browser-CORS CDN proxy (extra edge hops) instead of possibly-faster direct npmjs — untested from the VM, and RU-region routing to npmjs might actually be slower/throttled, so it must be MEASURED before flipping.
epic: fast-install-resolver
blocked_by: []
sources: [docs/adr/npm-client/0194-eddy-v1-2-stateless-bundle-store-shared-resolve-caches-learned-pins.md, docs/adr/npm-client/0163-yandex-cloud-streaming-npm-registry-proxy.md, docs/public/hosting-eddy.md]
code: [services/eddy/src/bin.ts, deploy/yandex/eddy/docker-compose.coi.yml]
---

## Context

eddy v1.2 (ADR-0194) closed the client-side + server-cache levers on the
cold-origin floor: shared packument (TTL) + immutable tarball caches,
single-flight per dep-set, stateless Object-Storage bundle store. What v1.2
explicitly did NOT try (ADR-0194 §Deferred) is the **upstream** eddy resolves
against. The deployed VM sets
`REGISTRY_BASE_URL=https://registry.rifty.dev/npm-registry` — the Caddy CDN
registry-proxy (ADR-0163), built to give the BROWSER a CORS-clean registry;
the eddy SERVER needs no CORS, so it may pay cold-edge double hops
(VM → CDN edge → npmjs) that a direct `https://registry.npmjs.org` skips. The
walk is graph-depth-bound (packument concurrency 8→32 ≈ −10%; corgi
bytes-only ≈ no wall-time), so RTT-per-hop dominates the cold floor. The
catch: RU-region routing from the Yandex VM to npmjs is unknown — it may be
slower or throttled. Only decidable ON the VM, against the real cold path.
The v1.2 deploy (image `0.2.2` live) unblocked this.

## Acceptance

- Both upstreams measured FROM THE VM (`rifty-eddy`, the prod vantage —
  laptop numbers decide nothing): the same `eddy:0.2.2` image run as a SIDE
  container on a secondary port (e.g. 8081), one config per upstream
  (`REGISTRY_BASE_URL` = CDN-proxy vs `https://registry.npmjs.org`); the LIVE
  eddy container is not touched.
- Cold caches per run: the side container is RESTARTED before every run (the
  memory bundle store + in-process packument/tarball caches die with the
  process); dep set = the express+eslint class (~137 pkgs).
- Probe = unquantized wall ms of the bundle POST from the VM shell
  (`curl -w '%{time_total}'`), ≥3 runs per upstream, ALTERNATING A/B/A/B to
  control network drift; report per-run values + median + spread — never
  `pnpm bench` medians (250ms quantization grid hides sub-quantum deltas).
- Rate-limit watch on the direct-npmjs leg: any 429/throttle observed across
  the repeated cold resolves (eddy logs + upstream response codes) disqualifies
  the flip regardless of speed.
- The outcome is a RECORDED decision either way (CHANGELOG line + this item
  deleted): flip = one `REGISTRY_BASE_URL` line in `docker-compose.coi.yml` +
  tag-bump redeploy per `hosting-eddy.md` §Deploy; keep = npmjs recorded
  measured-worse-from-RU with the numbers.
- If flipped: `docs/public/trust-model.md` reflects that eddy's upstream is
  npmjs directly while the browser path keeps the proxy (ADR-0163's shared
  trust boundary forks) — checked, and recorded only if it actually forks.

## Fault matrix

| Fault | Expected outcome | Proof |
|---|---|---|
| Side container cannot start/listen on secondary port | Measurement aborts; live eddy container untouched | side-container command/logs |
| Restart-cold discipline not applied before a run | Run discarded; no median from warm contaminated samples | per-run restart log |
| Direct npmjs returns 429/throttle during repeated cold resolves | Flip disqualified regardless of speed | eddy logs + upstream status |
| Direct npmjs median is within spread or <20% faster | Keep CDN proxy; record measured-worse/insufficient delta | A/B run table + decision line |
| Probe uses laptop/browser bench instead of VM shell | Result invalid; item remains open | command provenance in recorded evidence |

## Parity cases

N/A — operator measurement + env flip; no Node-observable behavior. (The
resolver's behavioral parity is owned by the delivered eddy engine tests.)

## Out of scope

- The BROWSER registry path — stays on the CDN proxy (ADR-0163), never flipped
  by this item.
- Any eddy/npm-client code change — env-config only.
- Packument-cache TTL retuning, prefetch changes, h3 transport (sibling item
  `perf/eddy-http3-cold-validation`).

## Decisions

- Side-container A/B (docker run, secondary port, env-only diff) — the live
  service is never mutated during measurement; a flip is a separate
  tag-bump redeploy. REVERSIBLE.
- Cold = restart-between-runs (memory store + caches are process-lifetime);
  same dep set every run for identical work.
- Decision rule: flip only if the direct-npmjs median is ≥20% faster on the
  cold-origin resolve (clearly above run spread) AND zero rate-limit events;
  otherwise keep the proxy. Either way → CHANGELOG + delete this item.
- Execution is operator-gated (ssh/`yc` on shared infra = confirm-first); this
  contract records the exact procedure so an authorized session just runs it.
- REVERSIBLE — env-config measurement + recorded decision (CHANGELOG line).
  No ADR (browser path keeps the proxy; ADR-0163 uncontradicted).
