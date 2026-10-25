---
area: runtime-js
status: draft
title: "`MessagePort#postMessage` returns `true` and a transfer through a closed or moved port detaches, as in Node"
created: 2026-09-24
why: rifty's ports are Chromium's native ports behind the ADR-0447 wrapper, which keeps the native result — `postMessage` returns `undefined` (Node `true`) and a transfer list posted through a closed/transferred-away port keeps its buffers (Node detaches them)
sources: [docs/backlog/runtime-js/reference/message-port-ref-keepalive-evidence.md, docs/adr/runtime-js/0447-count-referenced-messageports-in-child-realm-keepalive.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/internal/message-port-ref.ts, packages/runtime-js/src/builtins/worker_threads.ts]
---

## Context

REV-12 discoveries of `runtime-js/reference/message-port-ref-keepalive-evidence.md`
(vitest-run-in-browser item 13; unit Out of scope "not claimed"; evidence
§IMPLEMENT reflection probe row `closed-post-kept`, §Chromium 148);
pre-existing Node-vs-Chromium platform differences. Re-run 2026-09-24:

```
$ node -e "const {port1}=new MessageChannel(); console.log(process.version, port1.postMessage('x'))"
v24.16.0 true
$ node -e "const {port1}=new MessageChannel(); const b=new ArrayBuffer(4); port1.close(); port1.postMessage('x',[b]); console.log(b.byteLength)"
0
$ (Playwright chromium page, same two programs)
148.0.7778.96 undefined / 4
```

Rifty (Chromium 148, evidence reflection probe): `closed-post-kept
true,4`; the wrapper (`message-port-ref.ts` `wrapMethod(Port.prototype,
'postMessage', …)`) returns the native result. The parity runner cannot
show either (rifty runs on Node's own `MessageChannel` there). Compat ⚠️
`docs/public/compat/process.md` "`MessagePort#postMessage` result and
closed-port transfers" (added with this draft).

## Next

Owner runtime-js. Trigger: a consumer branching on `postMessage`'s result
or relying on detach-on-send through a closed port, or the next
MessagePort unit. Parity first in Chromium browser-unit against the live
Node oracle: return value for port, `worker_threads.Worker`, and
`parentPort`; `byteLength` after posting through a closed and a
transferred-away port.
