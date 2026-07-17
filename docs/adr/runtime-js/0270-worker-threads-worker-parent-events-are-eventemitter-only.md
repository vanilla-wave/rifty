# ADR 0270: worker_threads.Worker parent events are EventEmitter-only

Status: Accepted
Date: 2026-07

> TL;DR: parent-side `node:worker_threads.Worker` emits `message`/`error`
> only through EventEmitter; assigned DOM callback expandos stay inert.

## Context

Node v24 has no `onmessage` or `onerror` property on parent `Worker` objects.
Assignments create ordinary callable expandos, but Node never invokes them.
`MessagePort` is different: it intentionally supports both EventEmitter and
`onmessage` listeners.

rifty declared parent `Worker.onmessage`/`onerror` and invoked them after the
Node event. `@emnapi/wasi-threads` detects Node, assigns its browser-shaped
handler, then bridges `worker.on('message')` into that handler. One child
`spawn-thread` frame therefore ran twice. Chromium traces showed two pthreads
with different tids and the same `startArg`; the duplicate trapped and killed
the Workbench owner. The self-referential unit contract had frozen the extra
DOM surface. Fault classes: `sibling-drift`, `frozen-assumption`.

## Decision

- Parent `Worker` declares neither DOM callback and emits each message/error
  only once through EventEmitter, for kernel and same-realm paths.
- User-assigned expandos remain ordinary JavaScript properties and are inert.
- `parentPort.onmessage`, the WorkerPort delivery helper, and child
  `globalThis.onmessage` remain unchanged; they implement MessagePort/worker
  entry behavior, not the parent Node Worker surface.
- Node parity pins property absence; an emnapi-shaped bridge test pins one
  handler call per child frame and fault.

Rejected: payload deduplication, emnapi detection, or listener-count branches.
They preserve two semantic delivery owners and can discard legitimate equal
messages.

## Consequences

- (+) `spawn-thread` cardinality and parent errors match Node.
- (+) One Worker event chokepoint kills the class across both backends.
- (−) Code relying on rifty's accidental Web Worker callback surface must use
  `.on('message')` / `.on('error')`.
