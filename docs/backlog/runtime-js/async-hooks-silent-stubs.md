---
area: runtime-js
status: draft
title: "`async_hooks.createHook` returns a hook whose callbacks never run, and `executionAsyncId()` a fabricated `0`"
created: 2026-09-24
why: Fidelity defect (AGENTS.md §Fidelity — no happy-path stub that lies) — a leak/handle detector built on `createHook` silently reports nothing where Node reports resources; must become real or a named loud throw + compat ❌
sources: [docs/backlog/runtime-js/absent-builtin-members-loud-throws.md, docs/backlog/runtime-js/reference/message-port-ref-keepalive-evidence.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/misc-stubs.ts, packages/runtime-js/src/builtins/index.ts]
---

## Context

REV-12 discovery reported by the `runtime-js/absent-builtin-members-loud-throws`
unit run (vitest-run-in-browser item 4; not in its committed evidence),
re-verified below; not tracked before this draft. `node:async_hooks` is
`misc-stubs.ts` `async_hooks`:
`createHook(_handlers)` returns `{ enable() {}, disable() {} }` and never
calls `init`/`destroy`/`promiseResolve`; `executionAsyncId()` returns `0`;
`triggerAsyncId` is absent. Silent — no `NotImplementedError`; compat ❌
`docs/public/compat/modules.md` "`node:async_hooks` `createHook` /
`executionAsyncId`" added with this draft.

Probe 2026-09-24 (scratch CJS parity case through
`tools/node-parity-runner` `runInNode`/`runInRifty`, rifty in the Node host
@ `8c8993649`): hook with `init(id, type)` recording types, enabled around a
1 ms `setTimeout`:

```
node v24.16.0: init-called true  | executionAsyncId 2 | triggerAsyncId function
rifty:         init-called false | executionAsyncId 0 | triggerAsyncId undefined
```

Reach (vitest 4.1.11 tree, `grep`): `dist/chunks/index.DXx9Dtk7.js:2`
imports `createHook`; `detectAsyncLeaks()` enables it when
`config.detectAsyncLeaks` (`base.B6Opl8PE.js:89`) — in rifty the option
reports no leaks instead of failing. The `hanging-process` reporter loads
`why-is-node-running` 2.3.0 (`index.UpGiHP7g.js:2179`), whose module body
calls `asyncHooks.createHook` — it would list no handles. Neither is on the
goal's default `vitest run` path.

`AsyncLocalStorage` / `AsyncResource.runInAsyncScope` are documented
sync-scope subsets (code comments), not part of this finding.

## Next

Owner runtime-js; trigger: now (standing Fidelity violation), or any
claimed consumer of `createHook`/`executionAsyncId`. Parity first: the
probe above (hook fires for a Timeout; `executionAsyncId` inside a
callback). Honest outcomes to decide at pickup: a named
`NotImplementedError('async_hooks.createHook')` /
`('async_hooks.executionAsyncId')` + compat ❌ (vitest links `createHook`
at load, so a loud *call* keeps the default path working), or a real subset
over rifty's own timer/immediate/promise scheduling.
