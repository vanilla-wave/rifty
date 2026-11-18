---
area: runtime-js
status: draft
title: node -e unhandled rejection fails at the next drain check, not at the microtask checkpoint
created: 2026-11-18
why: Node exits on an unhandled rejection right after the microtask queue drains; rifty's eval lifecycle lets other pending tasks run first, and loses a rejection raised inside an 'exit' listener.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

Node v24.16.0, `node -e "const p = Promise.reject(new Error('x')); setTimeout(() => p.catch(() => console.log('late-caught')), 10)"`
→ stdout empty, `[eval]` diagnostic, status 1. rifty (isolate host, ADR-0557;
the eval drain lifecycle is shared with the browser `node -e` path) prints
`late-caught` before the same diagnostic and status 1. Separately
`node -e "process.on('exit', () => { Promise.reject(new Error('x')) })"` →
Node status 1 with a diagnostic; rifty status 0, nothing printed (found by the
isolate-host Final+GREEN review); microtasks queued inside an `'exit'` listener
are dropped too (`process.on('exit', () => Promise.reject(1).catch(() => console.log('caught')))`
→ Node prints `caught`, rifty does not). The late-catch evidence was collected
in the isolate host, where isolated-vm adds ~10 ms before reporting a plain
rejection (instrumented child: catch @268 ms, report @280 ms); reproduce on
the browser `node -e` path before fixing here. Also: a handler chained after a
`fs.promises` call (`const p = Promise.reject(e); fs.promises.readFile('/nope').catch(() => {}).then(() => p.catch(…))`)
attaches before the unhandled check because rifty's `fs.promises` settles in
microtasks → exit 0, Node 1. Open: whether the rejection should
terminate before the next macrotask in every realm (kernel child, no-COI,
isolate) — `awaitDrain` owner.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
