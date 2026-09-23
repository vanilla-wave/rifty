# Symbol-key guard — Node oracle and RED (2026-09-23)

Base: `origin/main` 0c4c1b070. Oracle: Node v24.16.0. Ran the two
`tools/node-parity-runner/cases/modules/symbol-global-write-*.case.ts`
programs through `runInNode`:

```text
Node v24.16.0
ESM "{\"values\":[7,8,9],\"descriptor\":true}"
CJS "{\"values\":[7,8,9],\"descriptor\":true}"
```

RED command: `node --import tsx tools/node-parity-runner/src/cli.ts symbol-global-write`

```text
node-parity-runner: 2 case(s) matching 'symbol-global-write'
  ✗ modules/symbol-global-write-cjs.case.ts
    error: NotImplementedError: Not implemented: module-loader.cjs-global-function-assignment
  ✗ modules/symbol-global-write-esm.case.ts
    error: NotImplementedError: Not implemented: module-loader.esm-global-function-assignment
2 case(s) failed
```

Exit 1. Baseline unsafe-key guard test: 8/8 pass on both loader paths; those
existing ceilings must remain after the Symbol refinement.

Correction (2026-09-23): the first parity revision also read
`globalThis.Function`, an independently unsupported ADR-0171 path. Removed
that read from both cases. Re-ran the Node oracle and the two RED cases above
against the unchanged `origin/main` product source: same two directed Symbol
key false positives; no unrelated `Function` read remains in either case.
The unsafe-key tests now also assert that the `Function` descriptor is
unchanged immediately after the expected throw.

## GREEN

With the shared AST key classifier and scope-bound Symbol constants:

```text
$ node --import tsx tools/node-parity-runner/src/cli.ts symbol-global-write
  ✓ modules/symbol-global-write-cjs.case.ts
  ✓ modules/symbol-global-write-esm.case.ts
all cases match
```

The existing `function-constructor-import` parity cases also pass (2/2),
three targeted module-loader unit files pass (51/51), runtime-js typecheck
passes, and the source-size ratchet holds (CJS 2040 → 2006, ESM 1564 → 1528).

## Guard repair (2026-09-23)

Fault: `provenance-lie` at static Symbol-call classification → runtime property
key. Node v24.16.0 CJS, ESM, and CJS `with` probes turn a replaced
`Symbol`/`Symbol.for` result into string `Function` and mutate the global
constructor. Rifty's previous guard admitted those writes without an error.
The same exemption feeds assignment, descriptor, Reflect, and Object.assign
paths in both loaders.

RED on the root PR source with 8 new regressions: `symbol-global-write-guard.test.ts`
8 failed / 8 passed. The repair checks the admitted call result at runtime;
CJS `with` keys keep the static named ceiling because dynamic scope can shadow
the call and the guard binding. The runtime helper is held in an immutable
loader binding: a direct `eval` replacement of its generated parameter was
also RED (1/1) and now keeps the ceiling. CJS strict directives and shebangs
keep their source meaning. After repair: 26/26 unit, including ESM after
top-level await; Symbol parity 2/2;
Function-constructor parity 2/2; existing ESM/CJS Function ceiling conformance
3/3; runtime-js typecheck pass. The `Function` descriptor remains unchanged on
every rejected write.
