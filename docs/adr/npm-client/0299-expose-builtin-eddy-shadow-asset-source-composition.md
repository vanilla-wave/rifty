# ADR 0299: Expose builtin Eddy shadow asset source composition

Status: Accepted
Date: 2026-07

> TL;DR: npm-client exposes one builtin Eddy shadow-asset source factory;
> Workbench selects it from existing Eddy config and still owns one manager,
> writer, fallback, and source lifetime.

## Context

ADR-0249 leaves the owner manager on STD transport. The epic's Eddy closure
needs the same exact missing source set, but Workbench may import npm-client
only through its package root and must not gain a production dependency on
shadow-registry catalog internals. Passing catalog rows through Workbench would
duplicate ownership and expose an accidental external-registry SPI.

The source must reject builtin collisions before wire I/O, keep learned pins
for the owner lifetime, fall back Eddy -> STD through one bounded source, and
close the underlying STD source exactly once.

## Decision

npm-client exports `createBuiltinEddyShadowAssetSource`. It derives its closed
composition-time source request set from the builtin catalog inside npm-client
and delegates to the generic package-private Eddy source. Its public options
contain only resolver/bundle endpoints, the already-constructed STD source,
owner-lifetime learned-pin map, optional external fetch bounds, and warning
sink.

Workbench constructs the STD source first. With existing
`packageAcquisition.eddy`, it wraps that source with the builtin factory and
passes the result to the existing owner `ShadowAssetManager`; without Eddy it
passes STD unchanged. The wrapper owns and closes STD, so the construction
transaction owns only the selected source. No project install request, closure
hash, plan, receipt protocol, manager, store, or writer changes.

This API is builtin-only. External catalogs/source sets remain the explicit
follow-up recorded by ADR-0249; Workbench cannot inject source requests.

## Consequences

- Eddy asset closure uses the same package root boundary as other npm-client
  composition; Workbench never reads catalog data.
- Collision validation and owner-lifetime learned pins exist before the first
  POST/GET; fallback receipts remain transport-truthful.
- The additive public factory is a permanent builtin composition seam. It does
  not promise a generic source SPI.
- Adding an external source catalog still requires its own public trust and
  adapter decision.
