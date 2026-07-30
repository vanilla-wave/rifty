# ADR 0343: Auto-injected companions do not claim package bins without ordinary demand

Status: Accepted
Date: 2026-07

> TL;DR: a package reached only through Rifty's injected companion edge keeps
> its registry metadata but contributes no active package-bin claim; any
> ordinary edge to the same installed identity restores that claim.

## Context

ADR-0188 injects `@rollup/wasm-node` at Rollup's exact version so the patched
`rollup/dist/native.js` can use the WASM parser. The injected package is runtime
support, not a dependency requested by the project.

Both `rollup@4.62.2` and `@rollup/wasm-node@4.62.2` publish
`rollup -> dist/bin/rollup`. Before package-bin claim preflight, the linker
silently let the later package overwrite `.bin/rollup`. PR #233 exposed the
latent ambiguity: treating the injected support package as an ordinary
claimant makes every Vite 7 install loud-fail
`npm-client.bin-collision-reify`.

Suppressing the package name globally would break a project that ordinarily
depends on `@rollup/wasm-node`. Removing its registry `bin` metadata from the
install result or lock would also make a later replay unable to recover that
ordinary claim from authoritative lock data.

## Decision

- Each installed package path has monotone bin-demand provenance during the
  existing dependency walk.
- Root, dependency, and optional-dependency edges carry ordinary bin demand.
  The target package of a `companionRequestsFor(...)` edge alone does not.
  This exclusion does not propagate to that package's manifest dependencies.
- Reaching the same package identity and install path through any ordinary edge
  upgrades demand regardless of traversal order. It never downgrades.
- Companion-only packages retain exact tarball `package.json`, resolved
  `bin` metadata, install-result metadata, and lock metadata. Only the prepared
  view given to the shared package-bin linker omits their own active bin claim.
  Replay re-derives eligibility from the current graph.
- True ordinary same-scope duplicates remain governed by ADR-0335 and
  `NotImplementedError('npm-client.bin-collision-reify')`. Companion admission
  does not choose a collision winner.
- This stays package-private in npm-client. It adds no public option, catalog
  branch, package-name exception, or generic linker policy.

## Consequences

- (+) Vite's injected parser cannot steal or collide with Rollup's public CLI.
- (+) Direct or transitive ordinary demand for `@rollup/wasm-node` retains its
  real CLI claim, including after an auto-companion-only lock replay.
- (+) Registry bytes and metadata stay truthful; claim eligibility is separate
  package-manager provenance.
- (-) The dependency walk carries one additional monotone bit in its existing
  per-install-path schedule.
- Follow-up: package-bin link ingress applies ADR-0335 after this admission
  boundary; phased linking later consumes the same eligible claims directly.
