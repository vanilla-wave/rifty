---
area: toolchain-build
status: draft
title: The parity runner's rifty side runs a process.nextTick after a promise job queued later; Node and the product hosts run it first
created: 2026-11-25
why: a parity case on nextTick-vs-promise order is red in the runner while every product host equals Node, so the runner can neither prove nor guard that order
sources: [tools/node-parity-runner/cases/fs/callback-turn-order.case.ts, docs/backlog/epics/node-streams-as-in-node/reference/README.md, docs/backlog/runtime-js/stream-core-node-sources.md]
code: [tools/node-parity-runner/src/run-in-rifty.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

Program `process.nextTick(() => log('tick')); Promise.resolve().then(() => log('p'))` (PR #455 review,
2026-11-25, Node v24.16.0 → `tick, p`):

| host | rifty | how |
|---|---|---|
| parity runner (in-process) | `p, tick` | throwaway case under `cases/`, `pnpm test:parity` |
| isolate `runCode` (`node -e`) and sandbox `node main.cjs` | `tick, p` | `runCode` (`packages/isolate-host/src/run-code.ts`), `inSandbox` (`packages/isolate-host/tests/package-closure.ts`) |
| Workbench (COI) and SDK (no-COI) | `tick, p` | throwaway row in `tests/browser-unit/fixtures/node-file-programs.ts`, both node-file specs |
| streams probe harness (`reference/inproc.mts`, `require('process')`) | `tick, p` | `node --import tsx inproc.mts` |

The PR #455 review reported `p, tick` on every host; only the runner reproduced it here. Not the
same item as the fs callback timing on product hosts (closed by PR #468, `fs/callback-turn-order`):
this one is a runner-only nextTick order. Same
runner, aborted signal: `addAbortListener(aborted, …)`, then `nextTick`, then `then` → Node
`tick, listener, p`, runner `listener, p, tick`. Not established: why. Code-read leads (review):
- `patchPromiseForNextTick` is one-shot and realm-global; the runner's in-process side never calls it
  itself, but a same-realm `child_process` node spawn (`child_process-exec.ts:155`) and the
  worker-env child (`installNodeRuntime`) do, so whether `then` is patched depends on earlier cases;
- `ensureDrainScheduled` arms only when `nextTickQueue.length === 1` (`process.ts`); the queue is
  module-level and survives across cases, so a leftover entry leaves a new tick waiting for an
  unrelated drain.
Unprobed: the console REPL, which also uses `riftyProcess`.

Who it reaches: the runner is where unit 8c proves Node's nextTick-heavy stream core
(`runtime-js/stream-core-node-sources`: parity `cases/stream`, `from-web-options`); a runner-only order
gap can turn those rows red or hide a real one. Unprobed on `cases/stream`.

Streams goal: does this order change a matrix row? One probe: route B product core
(`ROUTE_B_GEN`, Node v24.16.0 `lib/`) with `process` = rifty's (`rifty-inproc-Bp`) against the same
with Node's own `nextTick` on that `process`. Throwaway column in a copy of `reference/`: `inproc.mts`
passes `process: Object.assign(Object.create(riftyRequire('process')), { nextTick: process.nextTick })`
when `PROBE_NODE_TICK=1`, `run.mjs` adds column `rifty-inproc-Bp-nodetick` with that env; route-B
module from `route-b/product/generate.mjs REPO <node-v24.16.0> OUT`; rows compared per `##` row,
`-Bp` line against `-Bp-nodetick` line. Results: 208/208 rows the same across every program `run.mjs` runs (`c-*`, `m1`–`m10`, `m1-hooks-matrix`, `w1`, `b1`).
Control showing the two columns order differently (`Readable.destroy()` then `then`): Node and
`-Bp` give `close, p`, the Node-tick column gives `p, close` (this harness runs the entry inside a
microtask, so Node's own `nextTick` there is not Node's after-main order; the title program through
the harness's `require('process')` gives `tick, p`). So in-process no matrix row depends on this order (Chromium not run).

## Question

Is the runner's order a harness wiring gap (state left by earlier work, a missing install step) or
a `riftyProcess` defect that other `riftyProcess` users (REPL) share? Until then, a nextTick-order
row cannot be a runner parity case; it is proved on the product hosts (node-file carrier, isolate).

## Challenge

challenge: 2026-11-25 — finding capture; no premise critic (README §Challenge)
