# ADR 0231: Host-owned bootstrap config for recursive node workers

Status: Accepted
Date: 2026-07-11

> Corrected 2026-07-15 (ADR-0249): the esbuild asset URL is no longer reserved
> host bootstrap. `RIFTY_ESBUILD_WASM_URL` is removed; verified bytes arrive
> through ADR-0266 capability ports. Kernel/node/SQLite bootstrap and env rules
> below stand.

> TL;DR: recursive Node workers receive an opaque host bootstrap snapshot that
> Node-faithful user `env` replacement cannot erase or override.

## Context

Node entry workers require kernel/node worker and SQLite/esbuild WASM URLs
before user code. `execSync(..., { env })` and
`worker_threads.Worker(..., { env })` replace the user's environment like Node,
but treating that record as the whole worker environment deletes rifty's host
capabilities and fails before the program. Defaulting URLs or cwd/env would be
equally dishonest.

Workbench centralizes deployment validation, but runtime-js must remain free of
Workbench and host-bundler imports.

## Decision

- `configureNodeEntryWorker(url, runtimeEnv)` installs the node-entry URL and an
  opaque snapshot of reserved host bootstrap variables.
- Every generic node-entry spawn merges user env first, host runtime env second,
  then operation control flags. Explicit user env remains replacement semantics
  for user variables; reserved runtime capabilities cannot be removed or
  overridden.
- Workbench derives the initial snapshot from validated
  `WorkbenchDeployment`; each node-capable child propagates the same snapshot.
  A Vite host only resolves asset URLs in its composition root.
- Omitted `execSync` cwd/env snapshot the calling process, matching Node.
  Missing process context or bootstrap config is an invariant error, never a
  `/workspace`, empty-env, or baked-URL fallback.
- The bootstrap channel is process-internal. It is not a public Workbench
  option bag and does not expose arbitrary host values to recursive spawns.
- Existing `setNodeEntryWorkerUrl(url)` remains the URL-only compatibility seam;
  it never invents runtime env. A recursive spawn that needs missing host
  bootstrap values fails loudly until its host adopts
  `configureNodeEntryWorker(url, runtimeEnv)`.

## Consequences

- Node-faithful env replacement and nested worker boot coexist without a
  reverse runtime-js→Workbench dependency.
- Reserved `RIFTY_*` keys remain implementation-owned and win collisions.
- Recursive runner, worker_threads, and real COI execSync tests pin inherited
  cwd/env, explicit replacement, and missing-config loud failure.
