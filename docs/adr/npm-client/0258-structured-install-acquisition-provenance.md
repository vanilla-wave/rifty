# ADR 0258: Structured install acquisition provenance

Status: Accepted
Date: 2026-07

> TL;DR: every install returns resolution, per-package transport, and the exact
> Eddy fallback reason; the old aggregate `source` remains compatibility-only.

## Context

Workbench's owner acquisition authority must report whether resolution used a
covering lockfile or registry metadata, how each package byte arrived
(`cache | eddy | registry`), and why Eddy fell back. `InstallResult.source`
currently collapses the whole install to `eddy | standard`, while
`onPackage.cacheHit` cannot distinguish an Eddy-seeded cache hit from an older
cache entry. Inferring these facts in Playground would duplicate npm-client's
lockfile/Eddy decisions and can report mixed installs falsely.

## Decision

Add required `InstallResult.provenance`:

```ts
type InstallAcquisitionProvenance = {
  resolution: 'lockfile' | 'metadata'
  packages: readonly {
    name: string
    version: string
    transport: 'cache' | 'eddy' | 'registry'
  }[]
  eddyFallback?: { reason: string }
}
```

npm-client records provenance at its existing resolution and tarball-fetch
seams. A complete verified Eddy bundle marks retained seeded hits as `eddy`;
ordinary cache hits remain `cache`; network tarballs are `registry`. A declined
or failed Eddy attempt retains its exact bounded reason through the validating
registry path. If that path also fails, the thrown error preserves both causes.

Keep `InstallResult.source` and `InstallProgressEvent.cacheHit` for compatibility,
but document them as lossy projections; new coordination must use
`provenance`. No new acquisition callback or adapter registry is public.

## Consequences

- Workbench can expose exact structured provenance without importing
  npm-client internals or parsing terminal warnings.
- Mixed cache/registry outcomes stay honest; Eddy failure never becomes a
  successful Eddy label.
- Install results gain a required field. Existing in-repo result literals and
  consumers must migrate in the same PR; the compatibility fields remain.
