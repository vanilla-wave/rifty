# Advanced fork IPC evidence — 2026-09-23

Node v24.16.0 oracle for the committed physical parity case:

```text
node --import tsx --input-type=module -e 'import c from "./tools/node-parity-runner/cases/child_process/fork-structured-serialization.case.ts"; import { runInNode } from "./tools/node-parity-runner/src/run-in-node.ts"; const out=await runInNode(c); console.log(process.version, out===c.expected); console.log(out)'
v24.16.0 true
{"messages":[["ready",{"date":"2020-01-02T03:04:05.000Z","map":7,"missing":true,"bytes":"0,128,255","big":"9","set":"a,b","regexp":"/ab+/gi","error":"boom/root","cycle":true}],["echo",{"date":"2022-03-04T05:06:07.000Z","map":11,"missing":true,"bytes":"1,127,254","big":"13","set":"c,d","regexp":"/cd+/gm","error":"fail/branch","cycle":true}],["after"]],"invalid":["missing:TypeError/ERR_MISSING_ARGS","function:TypeError/ERR_INVALID_ARG_TYPE","nested-function:Error/no-code"],"invalidOption":"TypeError/ERR_INVALID_ARG_VALUE","connectedBefore":true,"connectedAfter":false,"exit":{"code":0,"signal":null}}
```

Rifty baseline:

```text
./node_modules/.bin/vitest run --project conformance tests/conformance/builtins/fork-advanced-ipc.test.ts
FAIL: NotImplementedError: Not implemented: child_process.serialization.advanced
  at packages/runtime-js/src/builtins/child_process.ts:325

node --import tsx tools/node-parity-runner/src/cli.ts fork-structured-serialization
FAIL: physical-worker parity expected 1 typed-bootstrap Worker; constructed 0

./node_modules/.bin/vitest run --project unit packages/runtime-js/src/internal/node-ipc-serialization.fault.test.ts
4 failed: circular graph enters JSON.stringify; nested function, Buffer and
accessor tests expected a loud error but none was thrown.

./node_modules/.bin/vitest run --project unit packages/runtime-js/src/builtins/node-entry-runtime-config.test.ts -t "admits advanced program IPC"
1 failed: TypeError: node-entry bootstrap launch.ipc must be none or json

node --import tsx tools/node-parity-runner/src/cli.ts public-ipc-json
1 case passed: default JSON sibling baseline
```

Node v24.16.0 extra probe: `Buffer` survives advanced IPC as `Buffer`, but
`structuredClone(Buffer.from([1,2]))` yields `Uint8Array` (`Buffer.isBuffer`
false). ADR-0448 makes that unsupported graph loud. Top-level
`send(undefined)` → TypeError/ERR_MISSING_ARGS; `send(function)` and
`send(Symbol)` → TypeError/ERR_INVALID_ARG_TYPE; nested function → Error with
no code and message ending `could not be cloned.`

Node v24.16.0 advanced `send(new SharedArrayBuffer(4))` → Error with no code,
`#<SharedArrayBuffer> could not be cloned.`; native
`structuredClone(new SharedArrayBuffer(4))` succeeds. Rifty rejects this
Node-disallowed value before posting.
