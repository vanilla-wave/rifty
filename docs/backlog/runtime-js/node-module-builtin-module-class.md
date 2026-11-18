---
area: runtime-js
status: draft
title: "`require('node:module')` is Node's `Module` function"
created: 2026-11-18
why: rifty's `node:module` is a plain helper object (no `prototype`, `_resolveFilename`, `_load`, `_extensions`); Node returns the `Module` function, which require hooks patch (`Module.prototype.require = …` throws `TypeError` in rifty)
sources: [docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/module.ts, packages/runtime-js/src/module-loader/loader.ts]
---

## Context

PR #408 outside finding 3. Node v24.16.0: `const M = require('module')` →
`typeof M` `function`, `M === M.Module` true, `typeof M.prototype.require`
`function`, `M._resolveFilename`/`M._load` functions, `M._extensions` object.
Rifty no-COI project command: `typeof require('node:module') + ' ' + typeof
require('node:module').prototype` → `object undefined`; a set-state probe that
patched `Module.prototype.require` died `TypeError: Cannot read properties of
undefined (reading 'require')` (PR #408 probe). `builtins/module.ts` exports a
plain object whose `Module`/`default` is a second helper object. It also
ships `syncBuiltinESMExports` as a silent no-op ("Best-effort no-op", code
read, not probed) — a Fidelity gap of its own (real or `NotImplementedError`).
Related: `require-extensions-extensionless-resolution` (Node:
`Module._extensions === require.extensions`).
compat modules.md "`node:module` helpers" says `Module.*` mirrors are
implemented.

## Next

Owner runtime-js. Parity cases for `require('module')` identity/shape and a
`Module.prototype.require` / `Module._resolveFilename` hook (require-in-the-
middle, source-map-support) against live Node; the loader's per-generation
`node:module` override (`createLoaderModuleBuiltin`) is the existing seam.
`syncBuiltinESMExports` is decided with it.
