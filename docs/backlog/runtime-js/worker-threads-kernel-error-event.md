---
area: runtime-js
status: draft
title: worker_threads error provenance for uncaught global errors after entry
created: 2026-06-20
why: an uncaught timer callback in a kernel Worker exits 1 without the parent's error event
user_story: As a developer, I need an uncaught asynchronous Worker error to reach worker.on('error') with its real name, message and code before exit 1.
sources: [handoff-vite8-refactor-tails.md #6, packages/runtime-js/src/builtins/worker_threads.ts, docs/adr/kernel/0460-carry-originating-runtime-failures-in-sealed-worker-exits.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/kernel/src/spawn-worker.ts, packages/runtime-js/src/builtins/worker_threads.ts]
---

## Current boundary — 2026-09-23

ADR-0460 closed entry/preload failures and drain-recorded rejections: the
originating failure crosses the existing attested terminal frame before exit.
Explicit exit1 and handled uncaughtException do not create Worker.error.
This broader item remains open for unhandled global errors after entry.

Executed live Node24 and real Chromium/physical Worker, fresh port5444:

| Child source | Native parent events | Browser parent events |
|---|---|---|
| `setTimeout(()=>{throw Object.assign(new TypeError('async'),{code:'ASYNC'})},0)` | TypeError/ASYNC/async, then exit1 | exit1 only — RED |
| `Promise.reject(Object.assign(new TypeError('reject'),{code:'REJECT'}))` | TypeError/REJECT/reject, then exit1 | exact match — PASS |

Both parents naturally exit0; neither uses an artificial interval. Native and
browser compare name/code/message, TypeError identity, and ordered exit.
`installUnhandledErrorTrap` reports process exit and leaves default global
error delivery; it does not record the reason for the drain. The rejection
trap records its actual reason, so it reaches the new terminal payload.

Reproducer/artifacts: `/private/tmp/rifty-worker-async-audit/audit.spec.ts`,
`config.mts`, `browser.log`; browser trace retained beside them. Command:

```sh
RIFTY_PLAYGROUND_PORT=5444 pnpm exec playwright test --config /private/tmp/rifty-worker-async-audit/config.mts
```

## Next

Route the originating global error through the existing terminal authority;
no Error synthesized from exit1, no stderr parsing, no guest-forgeable IPC
error tag or second exit owner. Preserve handled process-error behavior.
Required native/physical browser guard: late timer throws TypeError with code,
parent gets that error exactly once before exit1, with normal cleanup/stdio.
Public compatibility remains partial: entry/preload/drain rejection supported;
unhandled asynchronous timer/global Worker.error remains unsupported here.
