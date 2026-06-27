---
area: runtime-js
status: active
title: Runtime-built Function import() routing cannot cross dynamic Function/eval scope
created: 2026-06-24
why: ADR-0171 routes `import()` inside lexical `Function` constructor sources by rewriting the syntax to a loader-owned helper. `with` or direct/dynamic `eval` inside the constructed source can materialize a helper-shaped binding at runtime without that exact binding name appearing in the source, turning Node's `import()` syntax into an identifier lookup and silently routing to user code. A nested runtime-built `Function("... import(...) ...")` has the same trust problem: the inner constructor would be the host/global constructor unless rifty provides a real realm/prototype membrane.
user_story: As a package author whose runtime-built function intentionally combines dynamic import with nested `Function`, `with`, or eval-created bindings, I want rifty to match Node's syntax-level `import()` semantics. Today rifty throws a directed `NotImplementedError` instead of leaking to host import or letting dynamic scope shadow the loader helper.
sources: [ADR-0171, package-tooling hardening 2026-06-24]
code: [packages/runtime-js/src/module-loader/function-import-routing.ts]
---

## Context

ADR-0171 covers package-tooling patterns such as:

```js
new Function('specifier', 'return import(specifier)');
```

The current implementation rewrites `import(specifier)` to a loader-owned helper
so the import resolves through the VFS loader. That is faithful for static
scopes and helper-shaped local names present in the constructed source.

Dynamic scope can still create a helper-shaped binding at runtime:

```js
new Function('specifier', `
  const n = "__rifty" + "DynamicImport";
  with ({ [n]: () => Promise.resolve({ v: "wrong" }) }) {
    return import(specifier);
  }
`);
```

Node's `import()` is syntax, not an identifier lookup. Rewriting this path would
silently let `with`/`eval` shadow the loader helper. Current behavior is a
directed ceiling:
`NotImplementedError('module-loader.function-constructor-dynamic-scope')`.

Nested runtime-built functions are the same ceiling:

```js
new Function('return Function("specifier", "return import(specifier)")');
```

The outer constructed function would otherwise return the host/global
`Function`, so the inner `import()` would no longer have a trustworthy VFS module
base.

## Options / Next

Parity-first when a real consumer needs this. Plausible fixes need an isolated
function/global realm or an import-routing mechanism that does not expose any
user-shadowable helper identifier inside dynamic scope and also routes nested
constructed functions without using the host/global constructor. Do not
approximate this with another generated name; computed bindings can still
collide.

## Reversibility

REVERSIBLE -- current state is an explicit loud ceiling plus compat note. A
later realm/membrane implementation can replace the throw after Node parity
cases capture nested Function, `with`, direct eval, and alias/dynamic eval
behavior in runtime-built functions.
