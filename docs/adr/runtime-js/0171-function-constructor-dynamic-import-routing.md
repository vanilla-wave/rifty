# ADR 0171: Function constructor dynamic import routing

Status: Accepted
Date: 2026-06

> TL;DR: Route `import()` created by runtime `Function` constructors through the same VFS module loader as static ESM and CJS `import()`, with the importing module id baked at construction time; keep `node:vm` and host infra outside this patch, and document global/pre-captured escapes as loud ceilings.

## Context

Prettier 3-class CLIs build their ESM importer at runtime:

```js
new Function("module", "return import(module)")
```

Load-time ESM and CJS transforms cannot see that `import()` because it lives in a string until user code calls the constructor. Without routing, V8 uses the host dynamic-import path, not rifty's VFS resolver, so relative VFS specifiers fail outside the loader. This blocks real package tooling even after `.bin` execution, CJS `import()` routing, and child-realm keepalive are present.

The risky part is base resolution: the dynamic import must resolve relative to the module that constructed the function, not the later caller. A global monkey-patch with no module context would silently resolve against the wrong base.

## Decision

**1. Route constructors only inside the module-loader execution context.**
`createModuleLoader` injects a proxy over the real `Function` constructor into ESM and CJS module execution. The proxy keeps native `Function` observables (`name`, `length`, prototype chain, `instanceof`) while rewriting only real `ImportExpression` nodes in the constructed body, then compiles a real JS function that closes over the loader's dynamic-import helper. Bodies without an `import` token use the native constructor unchanged. `AsyncFunction`/generator constructors are not Node global bindings; derived constructor access remains a ceiling.

**2. Bake the module id at construction time.**
The routed constructor closes over `resolved.id`, so `new Function(... "import('./x.mjs')")` constructed by `/pkg/bin.cjs` resolves `./x.mjs` from `/pkg/bin.cjs` even if the returned function is stored and invoked later.

**3. Keep `node:vm` and host infra out of scope.**
`node:vm` uses its own QuickJS/default-realm path and is not patched by this loader-scoped mechanism. Kernel/runtime infra that uses native `new Function` outside module execution remains native.

**4. Honest ceilings.**
`globalThis.Function`, derived host constructors such as `fn.constructor` / `asyncFn.constructor` / generator constructors, pre-captured host constructor references, and functions built outside the rifty module-loader context do not get a trustworthy module base. Because the lexical binding is a proxy, `Function === globalThis.Function` and `Function.prototype.constructor === Function` are also not claimed. These stay explicit compat ceilings rather than pretending to work with a guessed base.

## Consequences

- (+) Prettier-style runtime-built importers can load VFS modules.
- (+) The patch is scoped to guest module execution; no process-wide realm mutation leaks into `node:vm` or kernel internals.
- (+) The same dynamic-import keepalive path is reused, so detached constructor-built imports keep run-to-completion children alive until settle.
- (-) This is not a full browser constructor monkey-patch. Code that intentionally reaches `globalThis.Function` or a derived host constructor can still escape; public compat must call that out.
- Guard: `tests/conformance/modules/resolver.test.ts` covers ESM/CJS runtime-built `Function` import routing and constructor shape; parity cases `modules/function-constructor-import-{cjs,esm}` pin the claimed observables against Node.
