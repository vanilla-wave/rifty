# ADR 0201: Bounded-fetch chokepoint: no-progress stall bounds on all npm-client fetches

Status: Accepted
Date: 2026-07

> TL;DR: ONE internal module (`bounded-fetch.ts`) owns the header-wait + body-drain
> stall race for every npm-client network fetch (eddy attempts, prefetch, standard
> `RegistryClient`); the bound is a NO-PROGRESS window (default 10s) + byte cap
> (128 MiB), a breach is TRANSIENT (rides the existing retry ladder) then throws
> loudly; public surface = `RegistryClientOptions.stallTimeoutMs`.

## Context

Real npm bounds registry fetches (`make-fetch-happen`: `fetch-timeout` 300s
total-request, `fetch-retries` on idempotent GETs); rifty's standard
`RegistryClient` awaited headers and `json()`/`arrayBuffer()` bodies unbounded —
a hung registry/proxy parked `npm install` forever. The eddy paths were already
bounded (PR #107 r5–r17), but as three sibling implementations of the same race
(`drainBodyBounded`, installer's private `fetchHeadersBounded`, prefetch's
`headersBounded`) — the `unbounded-read` fault class survived #107 for 12 rounds
exactly because it was point-fixed per path (`docs/process/fault-classes.md`
§Class-kill).

## Decision

- **One chokepoint.** `packages/npm-client/src/bounded-fetch.ts` exports
  `fetchHeadersBounded` + `drainBodyBounded` + `DEFAULT_FETCH_STALL_MS` (10s) +
  `DEFAULT_FETCH_MAX_BYTES` (128 MiB). The eddy header-bound twins melted into
  it; `RegistryClient.getPackument`/`getTarball` route both phases through it.
  No second implementation of the timeout race may be added — extend this module.
- **No-progress window, not npm's total-request timeout.** A total cap aborts
  big slow-but-progressing tarballs; a no-progress window (chunk must arrive
  within the window) never does. Delta vs npm's 300s `fetch-timeout` is
  deliberate; the 10s default is the measured h2-stall class.
- **Stall/cap breach = TRANSIENT.** It feeds the existing `fetchWithRetry`
  backoff ladder (mirrors npm's `fetch-retries`; both standard calls are GETs);
  the retry attempt covers headers+body. After the last retry the error names
  the operation, phase, and bound. Worst case per fetch:
  (maxRetries+1) × 2×stall + backoffs.
- **Public API.** `RegistryClientOptions.stallTimeoutMs` (optional; default
  `DEFAULT_FETCH_STALL_MS`) mirrors `InstallOptions.resolverStallTimeoutMs`
  (ADR-0194). npm's config-key surface (`fetch-retry-*`, `fetch-timeout`) is NOT
  exposed — constructor options only.

## Consequences

- A stalled registry/proxy fails a standard install loudly within a bounded,
  retried window — parity with npm's behavior class, verified by the
  `registry.fault.test.ts` fault tier (stall pre-headers / mid-packument /
  mid-tarball / runaway body / slow-but-progressing / retry-recovers).
- The `unbounded-read` axis has one owner in npm-client; eddy messages and
  bounds are unchanged (aliased re-exports keep the historical names).
- Server-side eddy (`services/eddy`) keeps its own S3-store bounds (different
  package/runtime boundary) — out of scope here.
