---
area: runtime-js
status: draft
title: ESM namespace of a builtin lists keys in object order, not the spec's sorted order
created: 2026-09-23
why: `Object.keys(await import('node:fs/promises'))` starts `default,readFile,…` in rifty, `access,appendFile,…` in Node — module namespace [[OwnPropertyKeys]] is sorted by spec
sources: [docs/backlog/runtime-js/reference/path-posix-win32-builtins-final-green.json, docs/public/compat/modules.md]
code: [packages/runtime-js/src/module-loader/interop.ts]
---

## Context

REV-12 discovery at the `runtime-js/reference/path-posix-win32-builtins-evidence.md` Final+GREEN
review, re-run at land 2026-09-23 on `t3code/vitest-run-browser` (scratch
parity case, ESM): `import * as a from 'node:path/posix'; import * as b from
'node:fs/promises'; Object.keys(x).slice(0,4)` — Node v24.16.0
`_makeLong,basename,default,delimiter` / `access,appendFile,chmod,chown`;
rifty `default,sep,delimiter,join` / `default,readFile,writeFile,appendFile`.
Source ESM namespaces already match (`export const b…a…default` → both
`a,b,default`), so the gap is the builtin namespace (`interop.ts`
`primeCjsNamespace` defines `default` first, then static names in object
order); CJS-file namespaces share that constructor — unverified. Compat ⚠️
`docs/public/compat/modules.md` `node:` built-ins.

## Next

Owner runtime-js; trigger: a consumer iterating a builtin namespace's keys
(snapshot/serializer output), or the next builtin-namespace unit
(landed `runtime-js/reference/builtin-static-names-prototype-methods-evidence.md` touched the
same names).
Parity case first.
