---
area: runtime-js
status: draft
title: "The CJS/ESM Function-routing guard skips a module that spells `Function`/`global`/`globalThis` only with `\\u` escapes"
created: 2026-11-24
why: the raw-text prefilter `functionRoutingAnalysisToken` decides whether the AST guard runs; a module whose only tokens are `\u`-escaped identifiers passes it, so lexical `Function` is not routed and global-Function ceilings never fire — `import()` reaches the host, a called `global[k]` hands out the host constructor
sources: [ADR-0171, ADR-0444, docs/backlog/runtime-js/function-constructor-exhaustive-metaprogramming-ceiling.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/cjs-source-rewrite.ts]
---

## Context

Found by PR #439 review round 3 (unit `runtime-js/computed-global-read-callee`);
present before that PR. `cjs.ts` `functionRoutingAnalysisToken` (regex over the
raw source, checked before the acorn pass in
`rewriteCjsFunctionConstructorReferences`) and its twin in `esm.ts`
(`assertNoEsmFunctionRoutingCeiling`) match `\bFunction\b`, `\bglobal\b`, … in
the source text. An identifier written with escapes (`\u0046unction`,
`\u0067lobal`) is the same binding to V8 and acorn but not to the regex: with
no other unescaped token in the file, the guard does not run.

Probe 2026-11-24 at `657c3e589` and at `c2be2193a` (same output),
`createModuleLoader(MemoryFsSync)` (`pnpm exec tsx`), `/w/dep.mjs` =
`export const value = 'vfs-dep'`, `f('Function', 'return 1')`:

```
CJS exports.f=function(k,s){ return new global[k](s); }           loads; CALL-THROW module-loader.cjs-global-function-assignment (base: LOAD-THROW)
CJS exports.f=function(k,s){ return new \u0067lobal[k](s); }      loads; constructed by host Function: true
CJS exports.f=function(){ return new Function("return import('./dep.mjs')")(); }        loads; import -> vfs-dep
CJS exports.f=function(){ return new \u0046unction("return import('./dep.mjs')")(); }   loads; import -> reject ERR_MODULE_NOT_FOUND
ESM export function f(k,s){ return new \u0067lobalThis[k](s); }  loads; constructed
```

Node v24.16.0, same escaped file as `esc.js` beside `dep.mjs`:
`node -e "require('./esc.js').f().then(m=>console.log(m.value))"` → `vfs-dep`.
The `import()` reaches the host's loader, not rifty's; its rejection code is the
host's (`ERR_MODULE_NOT_FOUND` here; `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` on
a host without a dynamic-import callback, per the reviewer — not measured here).

## Next

Owner runtime-js (module-loader). Trigger: next guard unit, or a package
spelling these identifiers with escapes. Candidate (reviewer's, no spike): test
the prefilter against `decodedNames(source)` (`cjs-source-rewrite.ts`, already
used by `uniqueHelperName`) in both formats; acorn reports decoded names, so the
AST pass needs no change. Parity first: the escaped rows above against Node.
