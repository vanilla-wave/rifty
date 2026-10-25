---
area: runtime-js
status: draft
title: "`process` emits `'rejectionHandled'` when a reported rejection gains a handler later"
created: 2026-09-24
why: Node emits `'rejectionHandled'` for a promise already reported via `'unhandledRejection'` once it is handled; rifty never emits it, so trackers that pair the two events leak entries
sources: [docs/backlog/runtime-js/reference/process-lifecycle-events-exit-code-evidence.md, docs/adr/runtime-js/0445-dispatch-node-process-lifecycle-events-before-terminal-handling.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process-lifecycle-events.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/process-lifecycle-events-exit-code-evidence.md`
(vitest-run-in-browser item 7; unit Out of scope). No runtime-js code
listens for the realm's `rejectionhandled` (`grep -rni rejectionhandled
packages/runtime-js/src` → 0 hits @ `8c8993649`).

Probe 2026-09-24 (scratch `child-worker` parity case, forked child through
the kernel Worker route, `tools/node-parity-runner` `runInNode`/
`runInRifty` @ `8c8993649`): child with `'unhandledRejection'` and
`'rejectionHandled'` listeners, `const pr = Promise.reject(new
Error('late')); setTimeout(() => pr.catch(() => {}), 10)`:

```
node v24.16.0: ["unhandled late","rejectionHandled","done"] code 0
rifty:         ["unhandled late","done"]                    code 0
```

Compat ❌ `docs/public/compat/process.md` "`'rejectionHandled'` event".

## Next

Owner runtime-js (ADR-0445 dispatch). Trigger: a claimed consumer
listening for `'rejectionHandled'`. Parity first: the probe above, the
promise identity argument, and ordering against a same-turn timer
(`runtime-js/late-unhandled-rejection-drain` owns Chromium's task-order
gap).
