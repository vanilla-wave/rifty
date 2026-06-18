---
area: runtime-js
status: active
title: Route dynamic import() inside CJS modules to the VFS loader
created: 2026-06-16
why: cjs.ts compiles a CJS module via new Function(module,exports,require,…) with NO routed dynamicImport, so any import() inside a CJS module hits the worker HOST import (not VFS-resolved) and fails — ESM-from-CJS dynamic import is broken
user_story: As a dev running a CJS-bin CLI that loads its ESM core via import() (common in modern tools), I want that import() resolved against the VFS like static ESM imports are — instead of failing because it escapes the loader.
sources: [ADR-0150, ADR-0009, ADR-0137]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/builtins/node-entry.ts]
---

## Context

The ESM transform (`esm.ts`, ADR-0009) rewrites `import()` to a routed `dynamicImport` injected into the module factory. The CJS path (`cjs.ts:134`) compiles via `new Function('module','exports','require','__filename','__dirname', source)` — no `import`/`dynamicImport` injected — so a CJS module's `import('…')` uses the realm HOST dynamic import, which does not resolve VFS specifiers (a bare/relative path in a worker has no VFS base) → rejects. `node-entry.ts` already documents this ("dynamic import() inside a CJS module is not routed to the loader"). Pre-existing; P6a's CLI-in-child made it reachable end-to-end (a CLI that ENOENT'd on node_modules never got this far before).

HARD CEILING (sub-case, do NOT chase): a CLI that builds its importer at RUNTIME — `new Function("module","return import(module)")` (prettier@3 bin) — evades even a source transform (the import lives in a runtime string). Such CLIs are unsupportable without the tool's cooperation — a WebContainers/StackBlitz-class compat ceiling. Document in the compat matrix, don't fix.

CORRECTED 2026-06-18: "evades even a source transform" holds only for a LOAD-TIME transform. A `Function`-CONSTRUCTOR-time transform DOES reach it — see `[[patch-function-import-routing]]` (feasibility: CONDITIONAL-GO). This sub-case is reclassified from "do NOT fix" to "tracked, own ADR".

## Options or Next

Mirror `esm.ts`: a CJS source transform rewriting static `import(x)` → a routed call, plus inject `__riftyDynamicImport = (s) => loader.import(s, __filename)` into the CJS factory params. Covers normal CJS→ESM dynamic import; NOT the new-Function ceiling. Pairs with `runtime-js/child-realm-async-lifecycle` (the import is usually awaited in a detached promise).

## Reversibility

REVERSIBLE — additive loader capability (a transform + an injected binding); no public API change. Promote to ADR if it materially changes module-resolution semantics.
