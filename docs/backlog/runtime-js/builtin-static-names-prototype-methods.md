---
area: runtime-js
status: draft
title: Builtin static export names include prototype methods so `import { cwd } from 'node:process'` links
created: 2026-09-15
why: ESM link-time validation of a builtin uses `Object.keys(instance)`; `NodeProcess` methods (cwd, nextTick, hrtime, …) live on the prototype, so tinyexec's `import { spawn } ... ; import { cwd } from 'node:process'` fails with "does not provide an export named 'cwd'"
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/runtime-js/src/module-loader/cjs-interop-authority.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

`cjs-interop-authority.ts` `buildStaticNameNode`: `for (const name of
Object.keys(loadBuiltin(id)))`. In Node, `process.cwd` etc. are own
properties of the process object, so the ESM facade exposes them. rifty's
`process` builtin is a class instance; its methods are non-enumerable
prototype members and vanish from the static name set. Same shape risk for
any class-backed builtin. Runtime reads through the prototype already work.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)
