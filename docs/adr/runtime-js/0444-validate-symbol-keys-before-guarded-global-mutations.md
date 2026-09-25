# ADR 0444: Validate symbol keys before guarded global mutations

Status: Accepted
Date: 2026-09-23

> TL;DR: Share runtime primitive-symbol validation at otherwise-unknown global mutation keys; preserve Function ceilings.

## Context

ADR-0171 owns loader-scoped Function routing and host-constructor ceilings.
Its finite CJS/ESM guards also reject vitest's symbol-key timer storage and
undici's dispatcher property. Node v24.16.0 permits these writes.

`Symbol(...)` spelling cannot prove a symbol result: shadowing or a prior
`Symbol.for` monkeypatch can return `'Function'`. Probe and discriminating
REDs: [item5 evidence](../../backlog/runtime-js/reference/symbol-key-global-write-guard-precision-evidence.md).

## Decision

Supplement ADR-0171; its Function-routing and mutation boundaries remain.

- Both guards use one runtime key validator for otherwise-unknown computed
  global mutation keys. Evaluate the original key once, in place; return
  actual primitive symbols unchanged. Any other value throws the existing
  `module-loader.{cjs,esm}-global-function-assignment` before the mutation.
- Cover existing guarded member assignment/update/delete, Object/Reflect
  mutation and accessor calls, computed keys in literal assignment/descriptor
  maps. Static safe string keys retain existing behavior; static Function
  keys and opaque map sources/spreads retain parse-time ceilings.
- Validate values, not `Symbol` spelling, declaration kind or alias names.
  No Symbol rebinding, global patch or parallel symbol-binding analysis.
  Loader-owned helper injection is shared by CJS and ESM execution.
- Successful symbol keys preserve native evaluation order. Rejected dynamic
  keys now evaluate preceding source/key effects before the named ceiling;
  they do not undergo coercion or mutate the target. Function-read,
  derived-constructor and eval guards retain their existing scope.

Alternatives: spelling-based static exemption fails the actual monkeypatch
control; native Symbol injection would ignore the user's mutable binding;
an isolated realm is much broader than classifying one property key.
The chosen single value validator needs no symbolic state or new realm.

## Consequences

- (+) Real symbol-key global writes execute; forged factories cannot touch Function.
- (+) Existing CJS/ESM mutation families share one primitive-type authority.
- (-) Dynamic rejection timing is runtime; document and test preceding effects.
- Contract+RED certifies timing/order and retained ceilings before source changes.
