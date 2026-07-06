---
area: npm-client
status: ready
title: No-progress bound on STANDARD-path registry fetches (packuments + tarballs)
created: 2026-07-04
why: every eddy acquisition path is now stall-bounded (prefetch drain + direct GET/POST streams, PR #107 rounds 5–6), but the standard install's registry fetches still await an unbounded body — a registry/proxy that hangs mid-response parks `npm install` forever; real npm bounds this (make-fetch-happen timeouts + retries)
user_story: As a user on a flaky registry/proxy, I want a stalled packument or tarball fetch to fail loudly (and retry/abort) after a bounded wait, but today the standard install waits forever with no error.
epic: cold-npm-install-speedup
sources: [https://www.npmjs.com/package/make-fetch-happen, https://docs.npmjs.com/cli/v11/using-npm/config, docs/process/fault-classes.md]
code: [packages/npm-client/src/registry.ts, packages/npm-client/src/eddy-bundle-stream.ts, packages/npm-client/src/installer.ts]
---

## Context

Successor to the eddy-scoped `eddy-direct-path-no-progress-bound` item (closed
2026-07-04: `streamTarEntries` bounds — no-progress timeout + byte cap — now
cover the direct GET/POST paths; `drainBodyBounded` covers the prefetch;
`fetchHeadersBounded` in `installer.ts` covers the header phase). The SAME
hang class (`unbounded-read`, `fault-classes.md`) remains on the standard path:
`RegistryClient.getPackument`/`getTarball` await headers with no bound and
consume bodies via bare `json()`/`arrayBuffer()`. Pre-existing on main (not a
PR #107 regression) and shared by every install mode as the final fallback —
so a bound here also caps the worst-case of an eddy decline chain.
`fetchWithRetry` already retries TRANSIENT failures (429/5xx/network error)
with `Retry-After`/exponential backoff — the retry half of real npm's
`make-fetch-happen` semantics exists; only the bound half is missing.

## Acceptance

- ONE bounded-fetch chokepoint (npm-client-internal module) owns the stall
  race: `fetchHeadersBounded` (moved out of `installer.ts`) + `drainBodyBounded`
  + the bound constants, reused by BOTH the eddy attempt paths and
  `RegistryClient` — no second implementation of the timeout race
  (fault-classes §Class-kill for `unbounded-read`).
- `getPackument` and `getTarball` bound BOTH phases: response headers must
  arrive within the stall window (fetch aborted via `AbortSignal` on breach)
  and every body chunk must arrive within the same no-progress window, under
  the shared byte cap (`DEFAULT_BUNDLE_MAX_BYTES`).
- A stall/byte-cap breach is classed TRANSIENT: it feeds the EXISTING
  `fetchWithRetry` ladder (backoff, `maxRetries`); one attempt = headers+body,
  so a body-phase stall retries too. After the last retry the install fails
  LOUDLY with an error naming the URL, the phase (headers/body), and the bound
  — never a silent park. Worst case per fetch is bounded:
  (maxRetries+1) × 2×stall + backoffs.
- `RegistryClientOptions.stallTimeoutMs` (optional) overrides the default
  bound, mirroring `InstallOptions.resolverStallTimeoutMs`; tests use small
  real-timer values (the `eddy-bundle-stream.test.ts` pattern).
- A slow-but-progressing body (chunks keep arriving within the window) is
  NEVER aborted, regardless of total duration.
- All existing npm-client tests stay green (healthy-path behavior unchanged).

## Parity cases

Real npm's bound lives in the CLI layer (`make-fetch-happen`), not the Node
runtime, so these pin the BEHAVIOR CLASS via fault tests against a stalling
fixture `Fetcher` (a live stalled-registry run vs the real npm CLI is not
CI-runnable; the class is verified against npm's documented
`fetch-timeout`/`fetch-retries` semantics):

- stalled mid-packument-body → loud error within the bound (npm: `FETCH_ERROR`
  after `fetch-timeout`), never a park — RED-first.
- stalled before tarball headers → same class, fetch aborted — RED-first.
- stalled mid-tarball-body → same class — RED-first.
- transient stall then healthy response → install SUCCEEDS via retry (npm:
  `fetch-retries` on idempotent GETs; both our calls are GETs) — RED-first.
- runaway body exceeding the byte cap → loud error, no unbounded buffering —
  RED-first.
- slow-but-progressing tarball → completes, no false abort.

## Out of scope

- npm's full retry/timeout config surface (`fetch-retry-factor`,
  `fetch-retry-mintimeout`, `fetch-retry-maxtimeout`, `fetch-timeout` as
  user-facing npm-config keys) — rifty exposes constructor options only; no
  loud-throw needed (absence = defaults, config keys are not a Node-observable
  surface).
- Proxy/keepalive/agent tuning and the offline HTTP cache `make-fetch-happen`
  carries — untouched.
- The eddy acquisition paths — already bounded (PR #107); this item only
  RE-ROUTES them through the shared module, no behavior change.
- Install-level cancellation (`AbortSignal` on `install()`) — separate
  concern; the signal here only tears down a stalled fetch.

## Fault matrix

| Axis × operation | Honest outcome |
|---|---|
| `unbounded-read` × packument headers stall | abort fetch at stall bound → transient retry → loud error after ladder |
| `unbounded-read` × packument body stall | drain throws at stall bound → transient retry → loud error after ladder |
| `unbounded-read` × tarball headers stall | same as packument headers |
| `unbounded-read` × tarball body stall | same as packument body |
| `unbounded-read` × runaway body (> byte cap) | loud throw naming the cap; transient-retried, then loud |
| `false-fallback` × slow-but-progressing body | NOT aborted — no-progress window resets per chunk; transparent success |
| `false-fallback` × stall on attempt 1, healthy attempt 2 | transparent success via existing retry ladder |

## Decisions

- Placement: shared internal chokepoint module (one `unbounded-read` boundary
  for npm-client): move `fetchHeadersBounded` from `installer.ts` +
  `drainBodyBounded`/constants from `eddy-bundle-stream.ts` into it;
  `streamTarEntries` (tar-specific) stays put. Internal-only refactor — none
  of these are in `src/index.ts`. REVERSIBLE.
- Bound semantics: NO-PROGRESS stall window (default
  `DEFAULT_BUNDLE_STALL_MS` = 10s, the measured h2-stall class) + byte cap —
  NOT npm's 300s total-request `fetch-timeout`. Rationale: a total cap aborts
  big slow-but-progressing tarballs; no-progress is strictly more honest for
  browser links. Delta vs npm recorded here. REVERSIBLE → CHANGELOG.
- Retry semantics: stall/cap breaches are TRANSIENT (network-error class) →
  existing `fetchWithRetry` backoff ladder; retry boundary widened to cover
  headers+body per attempt. Matches npm (`fetch-retries` on idempotent GETs).
- Knob: additive optional `RegistryClientOptions.stallTimeoutMs`, precedent
  `InstallOptions.resolverStallTimeoutMs` (ADR-0194 surface). REVERSIBLE.
