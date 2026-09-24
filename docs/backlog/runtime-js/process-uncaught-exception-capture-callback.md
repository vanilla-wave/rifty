---
area: runtime-js
status: draft
title: "`process.setUncaughtExceptionCaptureCallback` / `hasUncaughtExceptionCaptureCallback` exist with Node's semantics"
created: 2026-09-24
why: both are absent in rifty (`typeof` `undefined`), so a call is a bare `TypeError: … is not a function` — neither Node's capture (callback replaces `'uncaughtException'` dispatch) nor a named `NotImplementedError`
sources: [docs/backlog/runtime-js/process-lifecycle-events-exit-code.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/process-lifecycle-events.ts]
---

## Context

REV-12 discovery of `runtime-js/process-lifecycle-events-exit-code`
(vitest-run-in-browser item 7; unit Out of scope).

Probe 2026-09-24 (scratch `child-worker` parity case, forked child through
the kernel Worker route, `tools/node-parity-runner` `runInNode`/
`runInRifty` @ `8c8993649`): child prints `typeof` of both members:

```
node v24.16.0: set function has function
rifty:         set undefined has undefined
```

Compat ❌ `docs/public/compat/process.md`
"`process.setUncaughtExceptionCaptureCallback` /
`hasUncaughtExceptionCaptureCallback`".

## Next

Owner runtime-js (ADR-0445 dispatch). Trigger: a claimed consumer (REPLs,
domain-style wrappers) calling them. Parity first: capture replaces
`'uncaughtException'` listeners, second set throws
`ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET`, `null` clears, `has…` state.
Until real: the members stay absent (a named import is a link-time miss)
per ADR-0443 §2; a claimed consumer linking or reading them at load
admits named-loud members under ADR-0443 §1. Otherwise ship the real
capture semantics.
