---
area: runtime-js
status: draft
title: `process.stdout|stderr.write(chunk[, encoding], cb)` calls `cb` as in Node
created: 2026-10-16
why: rifty's stdio writer takes `write(chunk)` only and drops the callback; Go's wasm_exec waits on that callback for every stdout/stderr write, so upstream esbuild-wasm deadlocks (`fatal error: all goroutines are asleep - deadlock!`), and any program sequencing on the write callback stalls
epic: esbuild-upstream-twin
sources: [docs/backlog/npm-client/reference/esbuild-upstream-twin-refine-evidence-2026-10-16.md, docs/backlog/runtime-js/process-stdio-writable-end-surface.md]
code: [packages/runtime-js/src/builtins/process-stdio-writer.ts]
---

## Context

2026-10-20 — No-COI child work (PR #380) adds callbacks to the shared spec-seeded stdio writer. No-spec/root command sink callbacks remain this item’s scope; its full COI acceptance is not claimed here.

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

## Question

What callback timing and arguments does parity pin (after the bytes reach the
stdio port; `(err)` arity; order relative to later writes and to
`'drain'`; `encoding` handling for strings; callback when the port is closed),
on the kernel Worker route and the same-realm route? Settled at PICKUP by
Node probes.
