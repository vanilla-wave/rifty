---
area: runtime-js
status: ready
title: `process.stdout|stderr.write(chunk[, encoding], cb)` calls `cb` as in Node
created: 2026-10-16
why: rifty's stdio writer takes `write(chunk)` only and drops the callback; Go's wasm_exec waits on that callback for every stdout/stderr write, so upstream esbuild-wasm deadlocks (`fatal error: all goroutines are asleep - deadlock!`), and any program sequencing on the write callback stalls
epic: esbuild-upstream-twin
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md, docs/backlog/runtime-js/process-stdio-writable-end-surface.md]
code: [packages/runtime-js/src/builtins/process-stdio-writer.ts]
---

## Context

Finding (2026-10-16, evidence §Node-surface gaps, step a, layer f2):

- `node -e "process.stdout.write('a\n',()=>console.log('CB1'))"` → rifty `a`;
  Node 24.16.0 `a` `CB1`.
- `node node_modules/esbuild-wasm/bin/esbuild --version` → `0.28.0` then
  `fatal error: all goroutines are asleep - deadlock!` … `syscall.Write(0x1, …)`;
  with a callback-honouring child shim (f2) → `0.28.0`, `EXIT0`.

`makeStdioWriter` (`process-stdio-writer.ts:89-103`) ignores `encoding` and
`cb`. Upstream `esbuild-wasm/bin/esbuild` routes Go's `fs.write(1|2, …)` to
`process.stdout|stderr.write(buf, cb)`.

Related, not this item: `runtime-js/process-stdio-writable-end-surface`
(`end`/`writableEnded`/`destroy`, `pipeline`, `instanceof Writable`).

## Challenge

challenge: 2026-10-20 — clear; observed defects, goal premise unchanged.

## Acceptance

1. stdout/stderr write callback overloads, encoded bytes and callback timing match Node in kernel and same-realm execution. → I3

## Reference contract

Node v24.16.0; `tests/browser-unit/esbuild-node-surfaces.spec.ts` runs the
same supported scenario against Node and Chromium. Named unsupported Sync
results follow goal I2, not Node's success output.

## Out of scope

Other goal units remain linked on the map; no goal closure from this repair.

## Decisions

- 2026-10-20 — RDY-8 observed-defect route: real baseline + executed RED
  before implementation; independent Final+GREEN pending. Carrier: stdio write callbacks; process-stdio-callback.test.ts.
