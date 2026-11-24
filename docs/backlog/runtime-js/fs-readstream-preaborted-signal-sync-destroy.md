---
area: runtime-js
status: draft
title: A pre-aborted signal errors an fs read stream even when destroy()/close() follows synchronously
created: 2026-11-24
why: rifty defers the pre-aborted signal's abort to a microtask, so a synchronous `destroy()`/`close(cb)` after `createReadStream(p, { signal })` drops the AbortError Node emits
sources: [docs/backlog/runtime-js/fs-stream-close-method-missing.md, tools/node-parity-runner/cases/fs/read-stream-abort-destroy.case.ts]
code: [packages/runtime-js/src/builtins/fs-streams.ts]
---

## Context

Discovered during `runtime-js/fs-stream-close-method-missing` (2026-11-24). Node v24.16.0:

```
const s = fs.createReadStream('r.txt', { signal: AbortSignal.abort() });
s.close(cb);   // or s.destroy()
node  close:   error:ABORT_ERR | cb(ABORT_ERR) | close | open | ready
rifty close:   open | ready | close | cb(ERR_STREAM_PREMATURE_CLOSE)
node  destroy: error:ABORT_ERR | close | open | ready
rifty destroy: open | ready | close
```

(scratch parity case, Node v24.16.0 vs rifty on this unit's branch.)
Node's `addAbortSignal` destroys with the AbortError synchronously in the constructor.
rifty's `FileReadStream` constructor queues `this.abort()` in a microtask; a synchronous
`destroy()` sets `destroyed` first and `abort()` returns early — no `'error'`. Existing
parity `fs/read-stream-abort-destroy` covers pre-abort without a following destroy only.
Dedup: grep `abort` over `docs/backlog/runtime-js` — `add-abort-signal-reason-identity`
(Readable `addAbortSignal` cause) is a different surface.

Owner: runtime-js (fs streams). Trigger: a consumer passing an already-aborted signal and
tearing the stream down in the same tick; or the Readable conversion
(`runtime-js/fs-streams-not-node-streams`), which inherits Node's `addAbortSignal`.
