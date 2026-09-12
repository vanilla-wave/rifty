# ADR 0351: Async pre-entry readiness gates worker entry

Status: Accepted
Date: 2026-08

> TL;DR: Kernel awaits optional pre-entry readiness before guest code;
> runtime-js returns QuickJS preload only for Node workers selecting QuickJS.

## Context

`node:vm` QuickJS calls are synchronous after one async preload (ADR-0142).
Standalone runtime boot joined it; Workbench kernel children did not. A
Workbench-level preload fixes Node children but also delays WASI and rewrite
workers, moves runtime policy into the host, and requires an unrelated root
runtime-js export. The existing public pre-entry hook can express synchronous
installation only.

## Decision

1. `KernelPreEntryHook` returns `void | Promise<void>`. The kernel awaits it
   after publishing entry/process state and before importing guest code.
2. Hook rejection follows entry failure: stderr, exit 1, transferred-port and
   realm reap, including `serve` workers. No fallback.
3. `installNodeRuntime` installs globals synchronously, then returns QuickJS
   readiness only when the worker is Node-shaped and its selected VM engine is
   `quickjs`. WASI and rewrite return `void`.
4. Workbench registers that hook and installs the init listener synchronously;
   it neither selects nor preloads a VM engine.

## Proof contract

- Kernel unit: unresolved readiness blocks entry; resolution orders hook before
  entry; rejection reaps with exit 1 and stderr.
- Runtime unit: QuickJS Node returns readiness; WASI and rewrite do not preload.
- Consumer sweep: runtime-js module registration and Workbench explicit
  registration both use `installNodeRuntime`; no other pre-entry consumer.

## Fault matrix

| Fault class | Required proof |
|---|---|
| observable-order | guest entry starts only after readiness resolves |
| false-fallback | rejected readiness is loud exit 1 and full reap |
| sibling-drift | both registration paths share `installNodeRuntime` |

## Consequences

- (+) Runtime policy stays in runtime-js; kernel owns only lifecycle ordering.
- (+) WASI/rewrite workers pay no QuickJS preload cost.
- (-) A pre-entry callback may now extend boot asynchronously.

## Correction — 2026-08-11

The proof-contract sweep omitted the physical node-eval parity adapter. Its
wrapper awaits `installNodeRuntime` readiness; both product registrations remain
direct.
