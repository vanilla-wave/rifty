# Process named exports — Node oracle and RED (2026-09-23)

Base: `origin/main` 0c4c1b070. Oracle: Node v24.16.0.

`node --input-type=module` with the same source as
`tools/node-parity-runner/cases/process/named-method-exports.case.ts`:

```json
{"own":[true,true,true,true,true,true],"enumerable":[true,true,true,true,true,true],"namedIdentity":[true,true,true,true,true,true],"importedIdentity":[true,true,true,true,true,true],"callableCwd":true,"bigint":"function","absent":[false,false,false]}
```

RED command: `node --import tsx tools/node-parity-runner/src/cli.ts named-method-exports`

```text
node-parity-runner: 1 case(s) matching 'named-method-exports'
  ✗ process/named-method-exports.case.ts
    error: SyntaxError: The requested module 'node:process' does not provide an export named 'cwd' (imported by /work/main.mjs)
    node:   ""
    rifty:  ""
1 case(s) failed
```

Exit 1. The ESM link fails before the case body; no output shape can pass by
faking the `cwd()` return value.

## GREEN

After making the implemented process methods own properties:

```text
$ node --import tsx tools/node-parity-runner/src/cli.ts named-method-exports
node-parity-runner: 1 case(s) matching 'named-method-exports'
  ✓ process/named-method-exports.case.ts
all cases match
```

Exit 0. Four targeted unit files: 24/24 pass. Workspace typecheck and
`check:file-size` pass (`process.ts` 1226 → 1221 lines).
