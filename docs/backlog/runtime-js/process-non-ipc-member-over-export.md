---
area: runtime-js
status: draft
title: A non-IPC `process` exports `send`/`disconnect`/`connected`/`channel`/`_listenersMap`/`_warned` as `node:process` named imports
created: 2026-09-23
why: rifty's non-IPC `process` owns six enumerable members Node's lacks, so `import { send } from 'node:process'` links in rifty and is a link `SyntaxError` in Node
sources: [docs/backlog/runtime-js/reference/builtin-static-names-prototype-methods-evidence.md, docs/backlog/runtime-js/reference/builtin-static-names-prototype-methods-final-green.json, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/io/src/event-emitter.ts]
---

## Context

REV-12 discovery D1 of `runtime-js/builtin-static-names-prototype-methods`
(evidence §D1, Node v24.16.0 O1). Builtin ESM names are
`Object.keys(process)` (ADR-0348 §2). On a process with no IPC port rifty
still has own enumerable `send`/`disconnect`/`connected`/`channel`
(`undefined`; class fields `process.ts:495-498`) and the EventEmitter lazy
internals `_listenersMap`/`_warned` (`event-emitter.ts:22-32`, own once a
listener or warning is recorded). Probe (temporary esm case):
`- send:SyntaxError … _warned:SyntaxError` (Node) /
`+ send:linked … _warned:linked` (rifty). Node owns `send`/`disconnect`/
`connected`/`channel` only on an IPC child — unverified for the ESM facade
of a forked child. Compat ⚠️ `docs/public/compat/process.md` named-imports
row ("Known over-export").

## Next

Owner runtime-js; trigger: a consumer that feature-detects IPC by a
`node:process` named import or `Object.keys(process)`, or the next
`process` shape unit (`runtime-js/absent-builtin-members-loud-throws`,
`runtime-js/process-lifecycle-events-exit-code`). Oracle on a forked IPC
child first, then parity case.
