---
area: runtime-js
status: parked
title: node:vm context lacks real global-object property-attribute + strict-mode fidelity
created: 2026-06-13
why: adversarial parity sweep (closing vm-sandbox-residual-gaps) surfaced a NEW divergence class — the context is a plain-object property bag, so it has none of Node's vm global-object descriptor/lexical/strict semantics
sources: [M11, "vm-sandbox-residual-gaps adversarial review", ADR-0138]
code:
  [
    packages/runtime-js/src/builtins/vm.ts,
    tests/conformance/builtins/vm.test.ts,
  ]
---

## Context

`node:vm` runs context code in the HOST realm via `with(proxy) + eval(rewritten)`
over a PLAIN object (compat property bag, not a real global object). Closing
`vm-sandbox-residual-gaps` (function hoisting / completion values / destructuring
`var` patterns / post-run persistence; eval permanent per ADR-0138) left a
SEPARATE, previously-undocumented divergence class: the property bag has none of a
real vm global object's attribute / lexical / strict semantics. Verified vs real
Node (`tools/vm-diff-probe.ts` during review; harness removed):

- **Non-writable intrinsic globals.** `var undefined = 5` / `var NaN = 1` /
  `var Infinity = 0` (and bare `NaN = 1`) are silent no-ops in Node (non-writable
  data properties of the global) — rifty writes `helper.undefined = 5`, so the
  value sticks AND a spurious own-key appears on the sandbox.
- **Non-configurable var/function bindings + `delete`.** A top-level `var d`/
  `function f(){}` is a non-configurable binding: Node's `delete d` is a no-op
  returning `false` and the value survives. rifty's `delete helper.d` returns
  `true` and destroys the value (`var d = 5; delete d; d` → undefined vs Node 5).
  (The write itself still lands on the context, NOT the host — the write-leak
  class is closed; this is a configurability-attribute mismatch.)
- **Pre-declared lexical intrinsics.** `let undefined = 5` /
  `function undefined(){}` throw a redeclaration `SyntaxError` in Node (the vm
  global scope pre-declares `undefined` lexically) — rifty runs them.
- **`globalThis` write-shadow.** `var globalThis = 5; globalThis` reads back `5`
  in Node; rifty's proxy `get` hard-returns the proxy for prop `globalThis`
  (vm.ts contextProxy `get`), shadowing the user write → reads back the proxy.
- **`eval` name shadowing.** A user `var eval = 5; eval` reads the HOST `eval`
  function, because `eval` is a `HELPER_BINDING` (so the proxy reports it absent).
  Node reads the context var `5`. (This is a READ-resolution divergence on a var
  literally named `eval`; NOT the ADR-0138 host write-leak.)
- **Strict-mode undeclared writes.** `"use strict"; x = 1` throws `ReferenceError`
  in Node; rifty unconditionally rewrites the undeclared write to `helper.x = 1`
  (the rewrite assumes sloppy mode) so it silently succeeds.

## Options or Next

- Gate: a real consumer trips one of these (config/template code rarely
  redeclares intrinsics, deletes globals, or runs `"use strict"` top-level writes).
- Real fix is one change of substrate: back the context with a global-like object
  carrying genuine intrinsic descriptors (non-writable `undefined`/`NaN`/
  `Infinity`), make context var/function bindings non-configurable (so `delete`
  returns `false`), pre-seed a lexical `undefined`, stop the proxy from shadowing a
  written `globalThis`, and (strict path) detect a `"use strict"` prologue and emit
  a `ReferenceError`-throwing write instead of `helper.x = …`. Each is independently
  gateable; none is the eval gap.
- The honest framing already in `docs/public/compat/modules.md`: contexts are
  compatibility property bags, not security sandboxes — this item is the precise
  list of where the bag ≠ a real global object.

## Reversibility

REVERSIBLE — all are documented divergences of an internal rewrite over a property
bag; closing any is additive and gets a parity case first. A substrate swap to a
real global object, if attempted, gets its own decision record.
