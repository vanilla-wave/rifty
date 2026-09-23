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

## Implementation evidence — 2026-09-23

ADR-0443: immutable JSON+URI source identity, shared stack dispatcher, native
CallSite projection before custom formatters. No per-script lifetime registry.

Additional discovered REDs executed before correction:

- `host-offset-source-identity.case.ts`: `(b)` filename failed lookup; lone
  surrogate threw URIError. JSON+URI codec fixes both; parity GREEN.
- `host-offset-callsite-projection.case.ts`: custom renderer saw synthetic
  filename, physical 1:1, isEval true. Frame projection fixes native getters;
  parity GREEN, non-string renderer return preserved.
- `source-map-remap.test.ts` independent vm script with a loader's same filename:
  observed 81:5 instead of 1:6. String-level remap ordering alone did not fix
  custom formatters; final projection selects vm or loader authority per
  native CallSite before rendering.
- `vm.test.ts` nonzero sandbox run-option preservation: new Script merge erased
  pre-existing loud ceiling; constructor-offset assertion now separate.

## Exact Vite 8.0.16 interceptor

Downloaded unchanged packages into `/private/tmp/rifty-vm-offsets-vitest`:

```sh
npm pack vitest@4.1.11 @vitest/runner@4.1.11 @vitest/utils@4.1.11 vite@8.0.16 --pack-destination /private/tmp/rifty-vm-offsets-vitest --silent
```

Extract each archive under its package-name directory (`tar -xzf ARCHIVE -C DIR`).
Vitest `module-evaluator.js:192–206` evaluates a wrapped async function with
negative prefix columnOffset, then invokes the returned function. Its
`startVitestModuleRunner.DB-7oCpn.js:490` enables Vite's prepareStackTrace
interceptor. Vite `module-runner.js:954–960` reads CallSite source and positions
before source-map lookup. Thus string-only final remapping was insufficient.

Executed unchanged Vite interceptor with a real map:

```sh
node --import tsx --input-type=module <<'NODE'
import nativeVm from 'node:vm';
import * as riftyVm from './packages/runtime-js/src/builtins/vm/index.ts';
import {ModuleRunner} from '/private/tmp/rifty-vm-offsets-vitest/vite/package/dist/node/module-runner.js';
for (const [label, vm] of [['node', nativeVm], ['rifty', riftyVm]]) {
 const runner = new ModuleRunner({hmr:false,sourcemapInterceptor:'prepareStackTrace',transport:{invoke:async()=>{throw new Error('unexpected transport')}}});
 const filename='/virtual/generated.js';
 const map={version:3,sources:['original.ts'],names:[],mappings:'AAUA'};
 runner.evaluatedModules.ensureModule(filename,filename).meta={code:'0;\n//# sourceMappingURL=data:application/json;base64,'+Buffer.from(JSON.stringify(map)).toString('base64')};
 const prefix='(function(){ return ';
 const fn=vm.runInThisContext(prefix+'new Error().stack; })',{filename,columnOffset:-prefix.length});
 console.log(label,fn().split('\n')[1]);
 await runner.close();
}
NODE
```

```text
node     at /virtual/original.ts:11:1
rifty     at /virtual/original.ts:11:1
```

## Unresolved hook replacement boundary

```sh
node --import tsx --input-type=module <<'NODE'
import nativeVm from 'node:vm';
import * as riftyVm from './packages/runtime-js/src/builtins/vm/index.ts';
for (const [label, vm] of [['node', nativeVm], ['rifty', riftyVm]]) {
 const original = Error.prepareStackTrace;
 const error = vm.runInThisContext('new Error()', {filename:'/virtual/replaced-hook.js',lineOffset:10,columnOffset:5});
 Error.prepareStackTrace = undefined;
 console.log(label, String(error.stack).split('\n')[1]);
 Error.prepareStackTrace = original;
}
NODE
```

```text
node     at /virtual/replaced-hook.js:11:6
rifty     at eval (rifty-vm://10/5/%22%2Fvirtual%2Freplaced-hook.js%22:1:1)
```

Vitest utils `helpers.js:40–45` temporarily replaces the hook with `(e)=>e.stack`
then restores it; the inspected `vitest` caller is `test.DNmyFkvJ.js:3680`
`getImporter` for vi mocking. The accepted sum scenario does not call vi mocking.
Vite runner `close()` restores its module-import-time hook after reporting;
arbitrary late errors after hook replacement remain an unresolved limitation
for independent Final+GREEN authority assessment. No general hook-lifecycle
parity is claimed and no silent accessor/descriptor substitution is used.

## Final targeted checks

- `node --import tsx tools/node-parity-runner/src/cli.ts vm/` — 32/32 match.
- `pnpm test:run packages/runtime-js/src/module-loader/source-map-remap.test.ts tests/conformance/builtins/vm.test.ts` — 47/47 pass (7 loader-map, 40 vm).
- `pnpm test:browser-unit tests/browser-unit/vm-host-offsets.spec.ts` — Chromium 4/4 pass on final source: both certified matrices, filename identity, custom CallSites; each compares live native Node output.
- `pnpm backlog:check`, `pnpm refs:check`, targeted Biome, `git diff --check` — pass.
- Revert-check: temporarily restored both production owners from `04c50b9eb`,
  ran `this-context-offsets`: both certified cases RED, exit 1. `finally`
  restored implementation bytes; final Chromium 4/4 rerun passed afterward.

Product sizes: vm/index.ts 489 lines; source-maps.ts 368. No ratchet changes.
Full pr:check and independent Final+GREEN belong to parent integration.
