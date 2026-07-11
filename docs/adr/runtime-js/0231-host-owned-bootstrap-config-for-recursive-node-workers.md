# ADR 0231: Host-owned bootstrap config for recursive node workers

Status: Accepted
Date: 2026-07-11

> TL;DR: configure recursive node workers with a host-owned bootstrap env that user `env` replacement cannot erase.

## Context

The package-owned node bootstrap validates injected kernel/node worker and
SQLite/esbuild WASM URLs before user code. `execSync(..., { env })` and
`worker_threads.Worker(..., { env })` replace the user's environment like Node,
but passing that record as the whole worker env also deleted rifty's bootstrap
capabilities. The worker then failed before the program, while omitted
`execSync` options also incorrectly lost the caller's cwd/env.

## Decision

`configureNodeEntryWorker(url, runtimeEnv)` installs the node-entry URL and an
opaque snapshot of host bootstrap variables. Every generic node-entry spawn
merges user env first, host runtime env second, then its operation control
flags. Thus explicit user env remains replacement semantics for user variables,
while reserved runtime capabilities cannot be overridden or removed.

`@riftydev/workbench` configures this seam at its validated worker boundary and
again in every node-capable child. The Vite playground derives the same values
from one resolved workbench host config. Omitted `execSync` cwd/env snapshot the
calling process, matching Node; missing process context is an invariant error,
not a `/workspace`/empty-env fallback.

## Consequences

- Explicit env replacement and nested worker boot coexist; no asset URL default
  or Workbench-specific import enters runtime-js.
- Host runtime keys remain visible in `process.env`, as before, and win collisions;
  the `RIFTY_*` bootstrap namespace is implementation-owned.
- Legacy `setNodeEntryWorkerUrl(url)` still configures URL-only consumers. A
  package node bootstrap without runtime config fails loudly at its validation
  boundary.
- Guards: runtime config/recursive runner/worker_threads units plus the real COI
  execSync harness (inherited cwd/env and explicit-env replacement).
