---
area: runtime-js
status: draft
title: ESM module code runs in sloppy mode, with an object top-level `this` and the namespace as receiver of imported-function calls
created: 2026-09-23
why: ESM code is always strict with `this` undefined; rifty compiles module bodies as sloppy `new Function` and rewrites `f()` to `(__m0().f)()`, so undeclared writes create globals and `this` checks (UMD wrappers, receiver guards) see an object
sources: [docs/backlog/runtime-js/reference/builtin-static-names-prototype-methods-final-green.json, docs/public/compat/modules.md]
code: [packages/runtime-js/src/module-loader/esm-job-preparation.ts, packages/runtime-js/src/module-loader/esm-declaration-plan.ts]
---

## Context

REV-12 discovery at the `runtime-js/reference/builtin-static-names-prototype-methods-evidence.md`
Final+GREEN review: an imported `cwd` is called with a receiver, so no
committed carrier makes an unbound call. Re-probed and widened at land
2026-09-23 on `t3code/vitest-run-browser` (Node v24.16.0; temporary parity
case `kind: 'esm'`, `pnpm test:parity <case>`). `lib.mjs` exports
`who() { return this === undefined ? 'undefined' : this === globalThis ? 'global' : typeof this }`,
`strictLib()` (`undeclaredLibVar = 1` in try/catch) and `libThis = typeof this`;
the entry imports them, calls `who()`, `const alias = who; alias()`, does
the same undeclared write and an IIFE `this` check:

```
- {"direct":"undefined","alias":"undefined","nsCall":"ns","strictLib":"ReferenceError","libThis":"undefined","entryStrict":"ReferenceError","plain":"undefined"}
+ {"direct":"object","alias":"global","nsCall":"ns","strictLib":"sloppy","libThis":"object","entryStrict":"sloppy","plain":"object"}
```

Two mechanisms: the module body is compiled by `new Function` without a
strict directive (`esm-job-preparation.ts:100`, `:139`), and an imported
binding reads as `(__mN().name)` (`esm-declaration-plan.ts:219-224`), which
keeps the namespace receiver in call position even in strict code. The
browser realm shares both. Compat ❌ `docs/public/compat/modules.md` row
"ESM module code strict mode".

## Next

Owner runtime-js; trigger: a package whose ESM path branches on `this` or
relies on strict-mode throws, or any module-loader transform unit.
Parity case first; `"use strict"` in the factory may break transform code
that relies on sloppy semantics — check before adopting.
