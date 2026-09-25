---
area: runtime-js
status: draft
title: `require.resolve` of a bare builtin returns the `node:`-prefixed id
created: 2026-09-23
why: `require.resolve('fs')` is `'node:fs'` in rifty, `'fs'` in Node — a silent divergence under a bare ✅ compat row
sources: [docs/backlog/runtime-js/reference/path-posix-win32-builtins-final-green.json, docs/public/compat/modules.md]
code: [packages/runtime-js/src/module-loader/loader.ts]
---

## Context

REV-12 discovery at the `runtime-js/reference/path-posix-win32-builtins-evidence.md` Final+GREEN
review, re-run at land 2026-09-23 on `t3code/vitest-run-browser` (scratch
parity case, CJS): `for (const id of ['path/posix','fs/promises','fs','node:fs'])
console.log(id, require.resolve(id))` — Node v24.16.0 prints each id
verbatim; rifty prints `node:path/posix`, `node:fs/promises`, `node:fs` for
the bare spellings (`node:fs` matches). `makeRequire` returns the resolver's
canonical builtin id (`loader.ts` `req.resolve`). Compat ⚠️
`docs/public/compat/modules.md` `require.resolve`.

## Next

Owner runtime-js; trigger: a consumer comparing `require.resolve` output of a
builtin, or the next loader-resolution unit. Parity case first.
