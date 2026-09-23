# Symbol-key guard — Node oracle and RED (2026-09-23)

Base: `origin/main` 0c4c1b070. Oracle: Node v24.16.0. Ran the two
`tools/node-parity-runner/cases/modules/symbol-global-write-*.case.ts`
programs through `runInNode`:

```text
Node v24.16.0
ESM "{\"values\":[7,8,9],\"descriptor\":true,\"stringFunctionUntouched\":true}"
CJS "{\"values\":[7,8,9],\"descriptor\":true,\"stringFunctionUntouched\":true}"
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
