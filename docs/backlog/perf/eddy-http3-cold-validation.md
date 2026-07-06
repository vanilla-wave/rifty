---
area: perf
status: ready
title: Validate the eddy launch speed number on a real browser over HTTP/3 (warm h2 = 1.70x; h3 unmeasured)
created: 2026-06-28
why: warm h2 is measured at 1.70x (the launch number); the historical ~6x is a Node/sandbox model that assumed the bundled single stream beats the per-origin single-h2 tarball phase. HTTP/3 (advertised via alt-svc, untested) could lift the single-connection ceiling and shift the measured number — it must be confirmed on the real transport before any h3 figure is quoted.
user_story: As the maker quoting an eddy speed number at launch I want it measured on a real Chromium tab over the actual transport (h2/h3); warm h2 is 1.70x today and the h3 path is unmeasured (the "~6x" is a Node/sandbox model, never the launch quote).
epic: fast-install-resolver
blocked_by: []
sources: [docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/backlog/perf/reference/speed-benchmarks.md, docs/public/hosting-eddy.md]
code: [tools/perf/bench.mjs, deploy/yandex/eddy/docker-compose.coi.yml]
---

## Context

Warm-h2 is measured and quotable: **1.70x** (standard 4284ms → eddy 2517ms,
`real-vite` preset, median-of-5, `perf/benchmarks.json`; the ~6x was a
Node/sandbox model — never quote it). The engine, client, `pnpm bench`
harness, and a deployed eddy all exist. What remains is the ONE open risk from
ADR-0182 "Open validation": the 1.70x rode whatever transport Chromium
negotiated (h2); HTTP/3 could lift the standard path's single-h2-connection
tarball ceiling and narrow eddy's gap — or not. This item closes the epic's
"Done when" (a real-browser measurement over the actual transport confirms
the headline).

Two former blockers, both resolved: (a) "Playwright can't pin the transport"
— Chromium CAN be pinned per-origin via launch args (see Decisions); the
transport matrix below is DELIVERED (2026-07-07): `pnpm bench --transport
auto|h2|h3` pins + verifies via CDP evidence, smoke-proven live (h2 pass:
both origins evidenced `h2`, measured; h3 pass refused loudly pre-SG-rule).
(b) h3 was unreachable on the live deploy — compose already publishes
`443/udp`; only the reused `rifty-registry-proxy` security group lacks a
`443/udp` ingress rule (operator, confirm-first, `hosting-eddy.md` §Deploy
step 3). Remaining work = the SG rule + the measurement runs + the recorded
decision.

Folded (2026-07-01, ex `perf/install-transport-tuning`): fetch-semaphore
raise DROPPED (inert — one coalesced connection per origin); preconnect
SHIPPED (ADR-0195). Re-baseline with `pnpm bench` before attributing any
delta to h3: ADR-0195 + ADR-0187 each cut the eddy path's non-transport share
after the 1.70x measurement.

## Acceptance

- `tools/perf/bench.mjs` gains a transport matrix: per pass, Chromium is
  PINNED to a transport via launch args — h3 pass:
  `--enable-quic --origin-to-force-quic-on=<eddy-host>:443,<registry-host>:443`
  (both origins: the standard baseline's tarball phase is exactly the leg h3
  could lift); h2 pass: `--disable-quic`; plus the default `auto` pass (what a
  real user gets).
- Pin is VERIFIED, not trusted: the harness records the negotiated protocol
  per measured request (CDP `Network.responseReceived` → `response.protocol`,
  `h2`/`h3`) into the artifact; a pass whose observed protocol contradicts its
  pin (or mixes) is REFUSED loudly (a `note`, no median) — never a
  lying number.
- With UDP 443 live end-to-end: `perf/benchmarks.json` carries
  {h2, h3, auto} × {standard, eddy} medians + protocol evidence; the headline
  is re-derived from the AUTO pass (the transport real users actually get).
- Until the SG rule lands, the h3/auto-QUIC passes fail loudly at the
  protocol-evidence gate (that failure exercises the verification mechanics);
  no h3 number is quoted.
- Decision rule applied + recorded (see Decisions), epic Outcome updated with
  the transport-qualified number, this item deleted → epic's "Done when" met.

## Parity cases

N/A — measurement tooling + operator step; no Node-observable behavior. The
protocol-evidence gate is the harness's own honesty check (asserted by
running the matrix, not by unit parity).

## Out of scope

- Serving h3 itself — Caddy negotiates it natively once UDP 443 is open; no
  server code/config beyond the SG rule + existing compose.
- QUIC parameter tuning, 0-RTT, connection migration — measure stock.
- Non-Chromium browsers (project scope).
- `curl --http3` server-side timings — a vantage-poisoned proxy for a browser
  claim; the browser matrix above replaces it (curl is fine as the SG-rule
  REACHABILITY check, never as the quoted number).

## Decisions

- Transport control = PIN + VERIFY: per-origin QUIC forcing/disabling via
  Chromium launch args, negotiated-protocol evidence via CDP per request;
  observe-only (no pin) was rejected — it can't produce the h2-vs-h3 delta on
  demand; trust-the-flag (no evidence) was rejected — a silently-fallen-back
  h3 pass would quote an h2 number as h3. REVERSIBLE (bench tooling).
- Decision rule: if the AUTO pass matches warm-h2 within noise → headline
  stays 1.70x, recorded transport-insensitive. If h3 shifts either path →
  headline becomes the auto number. If h3 narrows eddy below **1.3x** →
  additionally record a NEW draft item re-scoping the bundle-vs-lockfile-only
  tradeoff (never silently absorbed). Every branch = CHANGELOG line + epic
  Outcome update.
- SG `443/udp` ingress rule = operator confirm-first; reachability check
  before any browser pass: `curl --http3-only https://eddy.rifty.dev/` (any
  response = QUIC end-to-end OK; timeout = rule not live).
- REVERSIBLE — measurement + recorded decision (CHANGELOG line). No ADR.
