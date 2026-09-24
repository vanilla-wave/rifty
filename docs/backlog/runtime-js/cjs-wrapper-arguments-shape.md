---
area: runtime-js
status: draft
title: CJS module `arguments` is Node's `(exports, require, module, __filename, __dirname)`
created: 2026-09-24
why: rifty's CJS factory takes `(module, exports, require, __filename, __dirname, <4 loader helpers>)`, so module code reading `arguments` sees 9 entries in another order and rifty's internal helpers
sources: [docs/adr/runtime-js/0444-check-runtime-global-write-keys-at-node-key-coercion.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

REV-12 discovery reported by the `runtime-js/symbol-key-global-write-guard-precision`
unit run (vitest-run-in-browser item 5, IMPLEMENT; not in its committed
evidence), re-verified below; pre-existing (8 entries before ADR-0444 added
the global-key helper, 9 now). `compileCjsSource`
(`cjs.ts` ~1790) compiles
`new Function('module', 'exports', 'require', '__filename', '__dirname',
<dynamic-import>, <Function>, <WebAssembly>, <global-key>, source)`.
Node's wrapper is `(exports, require, module, __filename, __dirname)`.

Probe 2026-09-24 (scratch CJS parity case, `tools/node-parity-runner`
`runInNode`/`runInRifty`, rifty in the Node host @ `8c8993649`):
`console.log(JSON.stringify([arguments.length, arguments[0] === exports,
arguments[1] === require, arguments[2] === module, arguments[3] ===
__filename, arguments[4] === __dirname]))`

```
node v24.16.0: [5,true,true,true,true,true]
rifty:         [9,false,false,false,true,true]
```

Compat ⚠️ `docs/public/compat/modules.md` "CJS wrapper `arguments`" (added with this draft).

## Next

Owner runtime-js (CJS loader). Trigger: a package reading the wrapper's
`arguments` (positional re-dispatch, `arguments.length` checks), or the
next CJS-wrapper unit. Parity first: the probe above plus
`Array.from(arguments).slice(5)` being empty. The helpers must stay
unreachable from guest `arguments` without breaking ADR-0171/ADR-0444
routing (they are lexical parameters today).
