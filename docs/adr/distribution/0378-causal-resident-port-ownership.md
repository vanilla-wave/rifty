# ADR 0378: Causal resident port ownership

Status: Accepted
Date: 2026-09-04

> TL;DR: resident readiness accepts only a port registered by the selected
> installed-bin loader generation.

## Context

ADR-0377 waits for the requested virtual port before reporting resident
readiness. A realm-wide live-timer census rejected a successful Vite build's
harmless unref cleanup timer yet missed native deferred work such as
`AbortSignal.timeout`, so it could both reject the goal's build→dev sequence
and accept a stale callback's target port.

Class-kill inventory found one boundary: `node:http`/`node:net` server
construction → registry bind → resident readiness. Alternatives:

- count every async source: rejected; browser promises/EventTargets have no
  complete handle census, and the Vite cleanup timer is not causal to bind;
- reset the whole Worker before every resident start: rejected; contradicts
  ADR-0377's existing-Worker start and duplicates explicit restart;
- bind an opaque owner to one loader generation: chosen; smallest carrier at
  the bind boundary, independent of timer/event source.

## Decision

`runBin` and `startBin` each receive loader-local `node:http`/`node:net`
facades. Servers constructed through a facade retain its opaque owner; the
port registry reports that owner on registration. `startBin` succeeds only
when its requested port carries its own owner. A target registration from an
older eval/bin rejects loudly; auxiliary ports remain allowed.

The owner is realm-local, never serialized or public SDK state. Existing
unowned registry callers retain their behavior. This adds no queue, retry,
timer census or second Worker.

## Consequences

- Native async source choice cannot forge readiness provenance.
- Successful finite tools may leave harmless unref work without blocking dev.
- The module loader gains one internal builtin-override seam; net owns the
  bound facades and registry token.
- One browser fault sweep crosses loader, net registry and resident admission.
