# ADR 0312: Keep synchronous SHA-256 implementations layer-local

Status: Accepted
Date: 2026-07

> TL;DR: keep runtime-js's Node crypto core plus exactly two package-private
> synchronous helpers at their architecture boundaries, prove the helper twins
> with the same vectors, and forbid a fourth implementation.

## Context

The package-tree contract added equivalent synchronous SHA-256 helpers in
Workbench's install-claim check and the shadow-registry esbuild contract probe.
Both callers must hash synchronously: Workbench gates sync package-tree reads,
while the probe runs in both Node and browser oracle realms. Web Crypto is
async, and `node:crypto` cannot enter the browser path.

Runtime-js already has a third browser-safe synchronous implementation behind
the Node `crypto` builtin. Its stateful core serves `createHash`, `hash`, and
HMAC compatibility; it is not a general hashing utility.

Exposing runtime-js's builtin-private engine would turn a Node compatibility
detail into a general primitive and make shadow-registry depend on runtime-js.
A shared module in Workbench would make tooling depend on a higher layer. A
shared module in shadow-registry would make Workbench depend on its npm-client
data dependency and risks the existing npm-client → shadow-registry cycle.
Moving a general hash primitive into VFS/IO solely for the two helper callers
would create a wider low-layer API without a shared domain contract.

## Decision

- Keep runtime-js's existing `crypto` implementation package-private to its
  Node compatibility surface.
- Keep exactly two additional package-private helpers: the Workbench install
  claim core and the shadow-registry contract-probe core.
- One shared fixed-vector table covers empty input, `abc`, a multiblock byte
  sequence, and non-ASCII text for both helpers; where Node crypto is available
  they are also checked differentially. Runtime-js stays covered through its
  Node crypto parity and unit contracts.
- The ratchet inventories all three implementations by FIPS round-constant and
  initial-state fingerprints, independent of local symbol names. No fourth
  production or probe-local synchronous SHA-256 implementation may be added.
  New consumers must reuse one layer-correct core or reopen this decision and
  place a general primitive at a justified lower layer.
- Async hashing continues to use Web Crypto and Node-only tooling continues to
  use `node:crypto`; those are platform adapters, not copies of this core.

## Consequences

- Architecture stays acyclic and browser bundles gain no Node dependency.
- The algorithm remains implemented in three files, but helper drift is
  observable through one vector contract and inventory drift through the
  three-copy ratchet.
- A future fourth synchronous implementation is a design trigger, not
  permission to paste the core again.
