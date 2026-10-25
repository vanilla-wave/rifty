---
area: runtime-js
status: draft
title: Kernel `worker_threads.Worker#postMessage` throws Node's `DataCloneError` instead of closing the channel
created: 2026-09-23
why: Node throws `DataCloneError` synchronously for an uncloneable message (a port not in the transfer list, a function); rifty's kernel path swallows it, closes the IPC control channel, loses every later message and the worker exits 1
sources: [docs/backlog/runtime-js/reference/message-port-ref-keepalive-evidence.md, docs/backlog/runtime-js/reference/message-port-ref-keepalive-final-green.json]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/kernel/src/process-manager.ts]
---

## Context

REV-12 discovery (Final+GREEN concern, Goal drift) of
`runtime-js/reference/message-port-ref-keepalive-evidence.md`; pre-existing, observed defect.
Probe (evidence §Sibling sweep, same source in Node and rifty `node main.cjs`):
`w.postMessage({ port })`, `w.postMessage({ fn })`, then `w.postMessage('after')`
→ Node v24.16.0 throws `DataCloneError` twice, child gets `"after"`, exit 0;
rifty no throw, times out, worker exit 1. Carrier: `Worker#postMessage` →
`WorkerProcessHandle.send` catch (`process-manager.ts`) treats every
`postMessage` throw as a disentangled port and calls `_closeControl()`.

## Next

Owner runtime-js; trigger: the next kernel Worker messaging unit, or a claimed
path posting an uncloneable value (vitest's I5 threads pool landed green:
`runtime-js/reference/vitest-run-acceptance-evidence.md`). Parity first: the probe rows above, plus
`DataCloneError` name/message and that the channel stays usable after the
throw. Route via `rifty-fix` (observed defect).
