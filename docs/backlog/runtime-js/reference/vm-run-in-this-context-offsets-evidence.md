# vm host-script offsets — 2026-09-23

Authority: goal I4/I5/I6; native Node v24.16.0. Prior evidence's clamp and
second-line column interpretation were incorrect; original historical output
alone did not establish either rule. Source owner currently rejects nonzero
offsets in `builtins/vm/index.ts` `assertSupportedScriptOptions`.

## Native oracle

```sh
node --import tsx --input-type=module <<'NODE'
import {runInNode} from './tools/node-parity-runner/src/run-in-node.ts';
import direct from './tools/node-parity-runner/cases/vm/run-in-this-context-offsets.case.ts';
import script from './tools/node-parity-runner/cases/vm/script-this-context-offsets.case.ts';
console.log(process.version);
console.log('runInThisContext');
console.log(await runInNode(direct));
console.log('Script.runInThisContext');
console.log(await runInNode(script));
NODE
```

```text
v24.16.0
runInThisContext
first:0:0 /virtual/vm-offsets.js:1:1
first:0:-20 /virtual/vm-offsets.js:1:-19
first:10:5 /virtual/vm-offsets.js:11:6
first:10:-20 /virtual/vm-offsets.js:11:-19
first:-3:-20 /virtual/vm-offsets.js:-2:-19
second:0:0 /virtual/vm-offsets.js:2:1
second:0:-20 /virtual/vm-offsets.js:2:1
second:10:5 /virtual/vm-offsets.js:12:1
second:10:-20 /virtual/vm-offsets.js:12:1
second:-3:-20 /virtual/vm-offsets.js:-1:1
returned-function /virtual/vm-offsets.js:11:1
late-stack-same-filename /virtual/vm-offsets.js:11:6
thrown-error /virtual/vm-offsets.js:11:-13

Script.runInThisContext
first:0:0 /virtual/vm-script-offsets.js:1:1
first:0:-20 /virtual/vm-script-offsets.js:1:-19
first:10:5 /virtual/vm-script-offsets.js:11:6
first:10:-20 /virtual/vm-script-offsets.js:11:-19
first:-3:-20 /virtual/vm-script-offsets.js:-2:-19
second:0:0 /virtual/vm-script-offsets.js:2:1
second:0:-20 /virtual/vm-script-offsets.js:2:1
second:10:5 /virtual/vm-script-offsets.js:12:1
second:10:-20 /virtual/vm-script-offsets.js:12:1
second:-3:-20 /virtual/vm-script-offsets.js:-1:1
constructor-options /virtual/vm-script-offsets.js:11:6
late-function-same-filename /virtual/vm-script-offsets.js:11:1
```

## RED

```sh
node --import tsx tools/node-parity-runner/src/cli.ts this-context-offsets
```

Executed: two cases fail, exit 1. Zero-offset rows match. Direct nonzero rows
throw `NotImplementedError: Not implemented: vm.runInThisContext.lineOffset`
or `.columnOffset`; Script rows throw corresponding `vm.Script` ceilings.
Every native row above with a nonzero offset differs; no product code changed.

`pnpm test:parity` initially failed before tests because tsx CLI opens a local
IPC socket forbidden in the sandbox. `node --import tsx` executes the same
runner without that unrelated CLI socket.

## Carrier constraints

Existing `module-loader/source-maps.ts` owns Error.prepareStackTrace dispatch
for loader source maps, scoped to an async call. Host vm returns synchronously
and functions/Errors escape it: a local wrapper cannot own their full stack
lifetime. Filename alone cannot key offsets, demonstrated by both late rows.
Source prefixes cannot represent negative line/column offsets honestly.
Implementation must preserve those native observables and existing loader
source maps; this preparation introduces no production carrier.
