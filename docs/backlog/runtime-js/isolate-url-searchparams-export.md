---
area: runtime-js
status: draft
title: "In the isolate guest `require('url').URLSearchParams` is the global's class, or the URLSearchParams ceiling's named gap"
created: 2026-11-24
why: `node:url` captures `globalThis.URLSearchParams` at runtime load, `undefined` in the guest (a ceiling global installed after load), so `new (require('url').URLSearchParams)()` throws `TypeError: u.URLSearchParams is not a constructor`; Node: `require('url').URLSearchParams === URLSearchParams`
sources: [docs/backlog/runtime-js/isolate-require-esm-syntax-gaps.md]
code: [packages/runtime-js/src/builtins/url.ts]
---

## Context

Found 2026-11-24 sweeping load-time captures of ceiling globals after PR #440 round 2 (the
`URLConstructor` seam). `runCode("const u = require('url'); console.log(typeof u.URLSearchParams, typeof URLSearchParams); new u.URLSearchParams('a=1')")`
→ `undefined function`, `TypeError: u.URLSearchParams is not a constructor`; Node v24.16.0: the
same class as the global. Same mechanism as `URLConstructor` (`url.ts:15`
`export const URLSearchParams = globalThis.URLSearchParams`), a sibling capture not covered by the
`posix-file-url.ts` forwarder. Other load-time captures of ceiling globals in runtime-js
(`node-ipc-advanced.ts` `structuredClone`, `fetch/platform.ts` `Response`) sit on paths the guest
does not reach (no IPC; `fetch` is a ceiling). Owner: runtime-js with isolate-guest. Trigger: a
package constructing it, or the guest gaining `URLSearchParams`. No compat row yet.
