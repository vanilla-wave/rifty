# ADR 0458: Read the realm-bound `node:process` registry entry uncached in io

Status: Accepted
Date: 2026-09-23

> TL;DR: io reads `node:process` through the registry factory, never the
> name-keyed cache (ADR-0035), so a same-realm child cannot pin its process.

## Context

`Readable.pipe` needs Node's bootstrap `process` to skip `dest.end()` on
`process.stdout|stderr` (evidence `docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md`).
io reaches it only through the ADR-0035 registry: runtime-js's `process` factory
returns the active bootstrap (`readActiveNodeProcessBootstrap`). The registry
caches per name. A same-realm child swaps the active bootstrap while it runs
(`child_process-exec.ts` `withChildProcess`), so the first `pipe()` there cached
the child's process. The parent's later `require('node:process')` then returned
it: not `=== process`, wrong pid, `exitCode` lost; its own `pipe(process.stdout)`
was no longer exempt (`TypeError: dest.end is not a function`). BASE and Node
return the parent's own process (carrier
`child_process/same-realm-child-pipe-parent-process.case.ts`).

## Decision

Add an io-internal `readBuiltinUncached` beside `loadBuiltin` in the ADR-0035
registry: it calls the registered factory and leaves the cache untouched. It is
not exported from `@riftydev/io`. `loadBuiltin` keeps its behavior and cache.

Candidates:
- Uncached factory read (kept): one function, no new seam; the factory is
  already the authority for which process is live.
- Registry never caches `process` (killed): it changes every loader
  `require`/`import` of `node:process` and the seeded harness's refresh
  contract. The same-realm child's `require('process')` already returns its
  own process without the registry (`child_process-exec.ts`). The regression
  came only from io's pipe read.
- A brand on the stdio streams (killed, #349): a `Symbol.for` key shows up in
  `getOwnPropertySymbols`, which Node does not have.
- A separate io owner seam (killed, #352): it repeats the process binding the
  registry already has.
- Reading `globalThis.process` (killed): it follows a guest reassignment. Node
  does not (evidence P6).

## Consequences

- `pipe()` compares against the current active bootstrap. That includes a
  same-realm child's own process while the child runs.
- The factory runs on every `pipe()`. It is only a read.
- Unchanged: a loader `require('node:process')` issued under a swapped bootstrap
  still caches. The Node-hosted `in-process-node-entry-runner` does this, but it
  is a test seam.
