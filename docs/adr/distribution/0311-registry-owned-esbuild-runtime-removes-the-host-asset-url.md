# ADR 0311: Registry-owned esbuild runtime removes the host asset URL

Status: Accepted
Date: 2026-07

> TL;DR: esbuild's exact runtime asset is acquired and attested by the builtin
> shadow registry, so Workbench no longer accepts a host-supplied esbuild WASM
> URL; ADR-0316 also retires the separate vendored WASI binding.

## Context

ADR-0263 made the browser host resolve Worker, service-worker, and WASM URLs.
That was correct while ADR-0226's Vite runtime was a Workbench deployment
asset, but ADR-0308 moves esbuild activation behind an installed substitution:
the recipe owns exact acquisition provenance, the registry store attests the
bytes, and direct `require('esbuild')` must use the same adapter as Vite.

Keeping `deployment.wasm.esbuild` would leave two authorities for the same
bytes. It would also make direct activation depend on Playground host
configuration instead of the admitted package tree. Removing the field changes
the published Workbench configuration, so the cutover needs a successor
decision rather than an incidental type deletion.

## Decision

- Remove the esbuild member from public Workbench deployment configuration and
  from Playground's bundler-query composition. No host URL, bundle asset, or
  host fetch path remains for the ADR-0226 browser runtime.
- The builtin `esbuild@0.28.0` recipe pins the exact runtime source, size, and
  digest. The registry manager acquires and verifies those bytes, and its
  admitted one-shot capability is the adapter's only browser-runtime source.
  Missing, corrupt, evicted, or offline-absent bytes fail loudly; there is no
  host fallback.
- ADR-0263's host-resolution rule remains for Worker, service-worker, and
  unrelated WASM deployment assets. This ADR supersedes it only for esbuild.
- ADR-0226's exact upstream client, guest-VFS environment, outer-object
  identity, and named gaps remain. ADR-0316 removes the separate
  build-time-vendored `@esbuild/wasi-preview1` binding; exact preview1 coverage
  survives only as an explicit package-sourced WASI guest.

## Consequences

- Direct esbuild and Vite cannot drift onto different runtime bytes or
  lifecycles.
- Hosts lose one public configuration field and must update at this release.
- Runtime readiness now depends on the registry's honest storage class and
  acquisition path; cold offline use fails visibly until a verified fill
  exists.
