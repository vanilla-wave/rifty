---
area: runtime-js
status: draft
title: Derived host Function constructors cannot route dynamic import
created: 2026-06-24
why: ADR-0171 routes lexical `Function` inside rifty-loaded modules, but `fn.constructor`, `Function.prototype.constructor`, and equivalent derived constructor paths read the browser host `Function`. Using them to compile source containing `import()` falls back to host dynamic import instead of the VFS module loader.
user_story: As a package author whose tool derives the `Function` constructor from another function and compiles dynamic-import source, I want rifty to resolve that import the way Node resolves it from the source file. Today rifty throws a directed `NotImplementedError` instead of silently host-routing.
sources: [ADR-0171, package-tooling hardening 2026-06-24]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/esm.ts]
---

## Context

Lexical `new Function('specifier', 'return import(specifier)')` is routed
through a module-scoped proxy. Derived constructors bypass that proxy:

```js
const F = (() => {}).constructor;
const dyn = F('specifier', 'return import(specifier)');
```

Node treats both constructors as the same process `Function` and resolves
`import(specifier)` relative to the calling module. In rifty, the derived
constructor is the browser host constructor; letting it run would resolve
outside the VFS loader or fail with a host dynamic-import callback error.

Current behavior is a directed ceiling only when static constructor arguments
contain `import`:
`NotImplementedError('module-loader.function-constructor-derived-host')`.
Runtime-computed constructor source is not inspectable by the loader and can
still execute through the host constructor, including a host-realm dynamic
import. This item owns that remaining derived-constructor gap; the shipped
compat claim is intentionally limited to statically visible source.

## Options / Next

Parity-first when a real consumer needs runtime-computed source. Plausible fixes
need an isolated realm/prototype membrane or a loader-owned Function prototype
path so `fn.constructor` and lexical `Function` share one routed constructor
without mutating the browser host.

## Reversibility

REVERSIBLE -- current state is an explicit loud ceiling plus compat note. A
later realm/membrane implementation can replace the throw after Node parity
cases capture `fn.constructor`, `Function.prototype.constructor`, `call/apply`,
and alias behavior.
