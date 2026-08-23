# ADR 0363: Eddy memory envelope and fail-fast admission

Status: Accepted
Date: 2026-08

> TL;DR: Eddy bounds resident metadata by bytes, coalesces each cached request
> across its full store/compute path, and admits only a configured number of
> distinct heavy POST flights; excess work fails fast with retryable 503 so the
> client uses its standard verifying fallback instead of wedging the origin.

## Context

On 2026-08-23 `eddy.rifty.dev` accepted TCP but neither TLS nor HTTP made
progress. Yandex metrics showed the 16 GiB network-HDD at ~100% I/O quota,
~12--14 MiB/s reads, and 14 average / 42 peak reads in flight while CPU,
network, and connection quotas stayed low. Restarting the 1 GiB VM cleared the
read storm and immediately restored the resolver.

The exact pre-restart PID is unavailable, so memory reclaim remains the leading
mechanism rather than a claimed forensic fact. The service nevertheless lacks
an enforceable memory envelope:

- the shared packument cache retains up to 4096 parsed objects but has no byte
  cap; TTL limits freshness, not residency;
- the shared tarball cache defaults to 512 MiB;
- cached single-flight starts only after the mutable-link store lookup, so
  identical warm POSTs duplicate S3 GET, verification, and bundle buffers;
- distinct dep sets and every `prefer:online` request compute concurrently,
  each with its own MemoryVFS and bundle assembly working set;
- a disconnected caller does not cancel work it alone owns.

ADR-0194 fixed immutable-store durability and same-key cold compute races. This
decision adds the missing process resource boundary without changing package
resolution, lockfile bytes, or the standard client path.

## Decision

1. `TtlPackumentCache` remains entry-bounded and becomes byte-bounded over its
   serialized UTF-8 representation. Oversize entries are not retained;
   expired entries are swept on writes. `EDDY_PACKUMENT_CACHE_MAX_BYTES`
   configures the cap; production uses 64 MiB.
2. Production config pins `EDDY_TARBALL_CACHE_MAX_BYTES=134217728` (128 MiB).
   Both caches are reconstructible optimizations; eviction changes latency,
   never the resolved closure.
3. A cached-policy flight owns the entire mutable-link lookup, store GET/proof,
   and fallback compute. Same-key callers join that one flight. Online requests
   remain non-joinable, preserving ADR-0194 freshness semantics.
4. One non-queuing admission owner bounds active POST flights. Production uses
   `EDDY_MAX_CONCURRENT_RESOLVES=1`. A distinct request above the cap receives
   `503`, `Retry-After: 1`, CORS, and `Cache-Control: no-store`; no waiter queue
   is created. The optional Eddy client therefore takes its existing standard
   verifying fallback.
5. Cached flights use waiter-counted cancellation: one disconnected waiter
   loses only its response; shared work aborts when every waiter is gone. An
   online flight is caller-owned and aborts directly. Admission releases only
   when the underlying work settles, including error and cancellation.
6. The abort signal reaches registry/install work. Bundle-store operations keep
   ADR-0194's existing 30-second bound and re-check cancellation before any
   link publish; a disconnected caller leaves no unbounded work.

## Fault matrix

| Boundary | Fault | Honest outcome |
|---|---|---|
| packument cache | entry count hides oversized resident bytes | exact byte LRU; oversize non-retention |
| cached same-key POST | duplicate store GET/compute | one full-path flight; per-waiter result |
| distinct/online POST | working sets exceed admission | immediate retryable 503, no queue |
| shared-flight caller | one waiter disconnects | only that waiter cancels |
| shared flight | all waiters disconnect | compute aborts; permit releases on settle |
| compute/store | success, throw, decline, or abort | exactly one permit release |

## Consequences

- Long uptime and novel-package traffic cannot grow shared metadata beyond an
  operator-visible byte budget.
- Load sheds before MemoryVFS/bundle working sets can starve Caddy or the VM;
  overload is slower standard installation, never wrong package behavior.
- Production initially serializes distinct POST flights. Operators may raise
  the cap only with a measured container memory envelope; same-key traffic and
  CDN GETs do not pay this serialization.
- Serialization/parsing on packument-cache hits trades some CPU for exact
  resident accounting. Network latency remains avoided.
- VM/container monitoring and disk/RAM alerts remain required: admission bounds
  Eddy work, not an unrelated guest process.
- Extends ADR-0194; no existing public npm-client behavior is superseded.
