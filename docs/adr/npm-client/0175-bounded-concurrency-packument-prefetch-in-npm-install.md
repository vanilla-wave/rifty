# ADR 0175: Bounded-concurrency packument prefetch in npm install

Status: Accepted
Date: 2026-06

> TL;DR: live npm install may prefetch registry packuments with bounded
> concurrency, but package placement remains strictly serial and request-ordered.

> Correction (2026-07-21, ADR-0303): surviving direct identities reserve flat
> slots before the serial descendant DFS. Request order governs descendants;
> prefetch and network completion still have no placement authority.

## Context

- Cold live installs were measured as a metadata waterfall: dozens of distinct
  packuments were fetched one at a time before tarball concurrency could stay
  saturated.
- Existing ADR-0042 placement is first-wins-flat + nest-on-conflict. The flat
  slot winner depends on dependency request order, not network completion order.
- ADR-0088 already allowed tarball fetch overlap because tarball bytes do not
  feed dependency discovery or placement.

## Decision

1. `createRegistrySource` owns a bounded packument fetch pool with cap 8, the
   same default cap used for tarball fetch. The cap is a perf knob only.
2. `ResolutionSource` gains optional `prefetch(name, range, ctx)`. Lockfile
   replay does not implement it. Registry replay uses it to start the effective
   package's packument fetch after overrides are applied.
3. `walkAndPin` warms sibling packuments when dependency names are discovered,
   before visiting those siblings serially. The placement path stays:
   `await source.resolve` -> `choosePlacement` -> recurse.
4. Registry packument fetches dedupe through an in-flight map and populate the
   existing `InstallOptions.packumentCache` on success. Rejections are kept loud
   when the serial visit reaches that dependency.
5. Optional-boundary tarball semantics are unchanged: the optional package's
   own tarball is awaited before recursing, so a failed optional still skips its
   whole subtree.

## Consequences

- Sibling metadata fetches overlap, so the install no longer waits for every
  packument round-trip serially.
- Express-diamond layout remains request-ordered: `ms@2.1.3` wins the flat slot
  and `ms@2.0.0` nests under `finalhandler`.
- A failing required dependency can have sibling packument requests already in
  flight. The install still rejects; the extra metadata requests are the cost of
  prefetching.
- Lockfile fast path behavior is unchanged.

## Acceptance criteria

- [x] Regression test proves packument `peakInFlight > 1`.
- [x] Same test keeps the express-diamond flat/nested layout pinned.
- [x] Existing tarball concurrency and optional-failure tests stay green.
- [x] Typecheck and Biome pass on the touched npm-client files.

## Reversibility classification

**IRREVERSIBLE** — introduces a new install scheduling mechanism and concurrency
policy. Recorded per record-and-continue.

## Cited ADRs and docs

- ADR-0042 — npm-client nested install placement.
- ADR-0088 backlog note — bounded-concurrency tarball fetch precedent.
- `docs/process/decision-workflow.md` — record-and-continue rule.
