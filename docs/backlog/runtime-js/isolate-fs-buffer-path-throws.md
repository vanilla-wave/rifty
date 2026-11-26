---
area: runtime-js
status: draft
title: In the isolate guest every sync fs call with a Buffer path throws "Right-hand side of 'instanceof' is not an object"
created: 2026-11-26
why: "`fs.readFileSync(Buffer.from('a.txt'))` throws a bare TypeError in the isolate guest: `fs-path.ts` checks `p instanceof URLConstructor`, and `URLConstructor` is `globalThis.URL` captured at load, when the isolate guest has no `URL`"
sources: ["PR #468 (runtime-js/fs-callbacks-io-turn) isolate run of `fs/async-arguments-at-call`"]
code: [packages/runtime-js/src/builtins/fs-path.ts, packages/runtime-js/src/internal/posix-file-url.ts]
---

## Context

Measured 2026-11-26 on main `c2250727d`. `runCode("const fs=require('fs');fs.writeFileSync('a.txt','abc');fs.readFileSync(Buffer.from('a.txt'),'utf8')")`
fails with `threw Right-hand side of 'instanceof' is not an object`; Node v24.16.0 prints `abc`.

`pathText` (`fs-path.ts`) tests `p instanceof URLConstructor` before `Uint8Array`, and
`URLConstructor = globalThis.URL` is captured when the runtime loads. The isolate guest
installs `URL` only later, as a ceiling global (`isolate-guest/src/guest/web-shim.ts`
`CEILING_GLOBALS`), so the capture is `undefined`. Every `Buffer` path goes through
`pathToString`, so this hits every sync form. The async forms validate their path at the call
from PR #468 on (`fs-arguments.ts` `validatedPath` turns a view into its text first), so they are
not affected. Dedup: no backlog
match.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
