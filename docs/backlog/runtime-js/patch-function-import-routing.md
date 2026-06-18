---
area: runtime-js
status: active
title: Own runtime-built import() by patching the realm Function constructor
created: 2026-06-18
why: prettier@3-class CLIs build their importer at runtime (new Function("m","return import(m)")), invisible to the load-time source transform — only a Function-constructor-time AST rewrite reaches it
user_story: As a dev running prettier@3 or any CLI that builds a dynamic-import thunk at runtime, I want import() inside those thunks resolved against the VFS — instead of escaping to the host loader and failing on VFS specifiers.
sources: [ADR-0004, ADR-0009, ADR-0142, ADR-0150]
code: [packages/runtime-js/src/module-loader/esm.ts, packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/internal/realm.ts, packages/kernel/src/ipc/sync-dispatch.ts]
---

## Context

`esm.ts` rewrites `import()` at load time; `cjs.ts` will get the same via `[[cjs-dynamic-import-routing]]`. Neither can touch a specifier that lives inside a runtime-constructed string: `new Function("m","return import(m)")` (prettier@3 bin pattern). The function body is parsed and executed by V8 at call time — no JS hook exists on native `import()`; import maps are document-level only; SW base-URL is fixed at registration. A 2-workflow empirical feasibility pass (routing real prettier@3) confirmed: **patching the realm `Function` constructor is FEASIBLE and is the ONLY physically-available lever on browser V8**.

The approach does NOT contradict ADR-0004/0009: it stays entirely in the transform-eval model, routing to the SAME loader that static and CJS dynamic imports use. Classification: IRREVERSIBLE-flavored (patches a JS builtin + changes module-resolution semantics) → own ADR required before merge.

### Feasibility constraints (must-have, from the pass)

- **SURGICAL**: word-boundary prefilter → skip bodies with no `import` token; AST-rewrite (not regex) for bodies that do; leave all others untouched.
- **Self-exempt**: rifty's own `new Function` sites (VFS bootstrap, keepalive poll, sync-dispatch backstop) must be whitelisted at patch installation time to avoid infinite recursion / double-routing.
- **EXEMPT `node:vm`**: `vm.Script` / `vm.runInContext` must bypass the patch entirely — else a silent ADR-0142 regression (vm's own realm patching would be double-applied).
- **Preserve Function identity**: `toString()` must return `"function anonymous(…) { … }"` (native-code string is wrong), `name`/`length` unaffected, `prototype.constructor` points to the real `Function`, `AsyncFunction`/`GeneratorFunction`/`AsyncGeneratorFunction` constructors patched consistently.
- **Base baked at construction time**: the caller's `import.meta.url` / `__filename` context must be captured when `new Function(…)` is called and baked into the routed loader call — NOT read from the live call stack at invocation time. Reading the live stack is wrong: a function constructed during one module's factory but invoked from another (or stored and called later) would silently resolve against the wrong base.
- **Residual escapes stay a LOUD ceiling**: pre-patch-captured `Function` references (`const F = Function; new F(…)`) and `Reflect.construct(Function, […])` are not reachable by this patch. Document in compat matrix as explicit ceiling — loud failure preferable to silent wrong resolution.

## Options or Next

1. Land `[[cjs-dynamic-import-routing]]` first (simpler, no builtin patch).
2. Implement Function-constructor patch in `realm.ts` (or a new `function-patch.ts`): intercept `new Function(…args)`, extract body, run word-boundary check, if hit → parse with acorn/meriyah, rewrite `import(EXPR)` nodes → `__riftyDynamicImport(EXPR)` with baked base, reconstruct source, call real `Function`. Install at realm creation.
3. Write a standalone feasibility test driving real prettier@3 bin through the patch before wiring the full path — confirms the must-have constraints hold empirically.
4. File ADR (IRREVERSIBLE) before merge.

Depends-on: `[[child-realm-async-lifecycle]]` (detached `module.exports.__promise` must drain before the Function-patch-routed imports resolve).

## Reversibility

IRREVERSIBLE-flavored — patches a JS builtin; changes module-resolution semantics for all runtime-constructed functions. Requires own ADR before merge.
