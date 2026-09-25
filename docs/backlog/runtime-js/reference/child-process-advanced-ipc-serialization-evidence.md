# Advanced public fork IPC — 2026-09-23

Authority: goal I4, ADR-0326 public-lane separation; selected migration ADR-0446
(proposed). User handed off the whole epic in one green PR. Native behavior,
not a package-specific data patch, determines the serializer. Preparation only;
no production codec or launch parser changed by this work.

## Native oracle

```sh
node --import tsx --input-type=module <<'NODE'
import {runInNode} from './tools/node-parity-runner/src/run-in-node.ts';
import rich from './tools/node-parity-runner/cases/child_process/public-ipc-advanced.case.ts';
import faults from './tools/node-parity-runner/cases/child_process/public-ipc-advanced-fault.case.ts';
console.log(process.version);
console.log('rich', await runInNode(rich));
console.log('faults', await runInNode(faults));
NODE
```

Exit 0, Node v24.16.0. Exact stdout per case:

```text
rich {"childValue":{"date":[true,"2020-01-02T03:04:05.000Z"],"map":[true,true],"set":[true,true],"regexp":[true,"test","gi"],"bytes":[true,[1,2,255]],"buffer":[true,[4,5,254],true],"bigint":["bigint","9007199254740993"],"error":[true,"failure","cause"],"array":[4,true,true,true,true,true],"cycle":true,"shared":7},"sendReturned":true,"getterReads":1,"childReceived":{"date":[true,"2020-01-02T03:04:05.000Z"],"map":[true,true],"set":[true,true],"regexp":[true,"test","gi"],"bytes":[true,[1,2,255]],"buffer":[true,[4,5,254],true],"bigint":["bigint","9007199254740993"],"error":[true,"failure","cause"],"array":[4,true,true,true,true,true],"cycle":true,"shared":7},"echo":{"date":[true,"2020-01-02T03:04:05.000Z"],"map":[true,true],"set":[true,true],"regexp":[true,"test","gi"],"bytes":[true,[1,2,255]],"buffer":[true,[4,5,254],true],"bigint":["bigint","9007199254740993"],"error":[true,"failure","cause"],"array":[4,true,true,true,true,true],"cycle":true,"shared":7},"connectedBefore":true,"connectedAfter":false,"killAfterDisconnect":true,"exit":{"code":null,"signal":"SIGUSR2"}}
faults {"childInvalid":[["undefined","TypeError","ERR_MISSING_ARGS",false],["function","TypeError","ERR_INVALID_ARG_TYPE",false],["symbol","TypeError","ERR_INVALID_ARG_TYPE",false],["bigint","TypeError","ERR_INVALID_ARG_TYPE",false],["nested-function","Error",null,true],["nested-symbol","Error",null,true],["weakmap","Error",null,true],["getter",["getter","same-error","after-send"]]],"childConnected":true,"parentInvalid":[["undefined","TypeError","ERR_MISSING_ARGS",false],["function","TypeError","ERR_INVALID_ARG_TYPE",false],["symbol","TypeError","ERR_INVALID_ARG_TYPE",false],["bigint","TypeError","ERR_INVALID_ARG_TYPE",false],["nested-function","Error",null,true],["nested-symbol","Error",null,true],["weakmap","Error",null,true],["getter",["getter","same-error","after-send"]]],"parentConnected":true,"seen":[1,2],"exit":{"code":null,"signal":"SIGUSR2"}}
```

## RED and prior baseline

```sh
node --import tsx tools/node-parity-runner/src/cli.ts public-ipc-advanced
pnpm exec vitest run packages/runtime-js/src/builtins/node-entry-advanced-ipc.test.ts
```

Physical parity: 2 RED, exit 1. Both native cases completed first; rifty's
pre-spawn advanced ceiling constructed 0 Workers. The existing physical audit
reports `physical-worker parity expected 1 typed-bootstrap Workers ... constructed
0, initialized 0`. It must remain: after implementation each case must prove a
real Worker, not silently pass in the host realm.

Owner parser: 4 RED, exit 1: constant is v4 rather than v5; producer and receiver
throw `launch.ipc must be none or json`; valid v4 remains accepted. Initial probe
used an invalid empty host snapshot; corrected to a real nonempty reserved
host fixture and reran, obtaining these intended failures.

Same-source direct probe identifies the earlier physical failure's cause without
weakening either committed case's Worker requirement:

```sh
node --import tsx --input-type=module <<'NODE'
import {runInRifty} from './tools/node-parity-runner/src/run-in-rifty.ts';
import rich from './tools/node-parity-runner/cases/child_process/public-ipc-advanced.case.ts';
console.log(await runInRifty({...rich,kind:'cjs',expectedPhysicalWorkers:undefined}));
process.exit(0);
NODE
```

```text
case-error:NotImplementedError:Not implemented: child_process.serialization.advanced (Node's advanced IPC serializer is not implemented; use default JSON)
```

Existing default-mode regression: `node --import tsx tools/node-parity-runner/src/cli.ts public-ipc-json` → 1 case matches, exit 0. Final preparation: `pnpm backlog:check`, `pnpm refs:check`, targeted `biome check` → PASS.

## Callback reference, existing loud gap

```sh
node --input-type=module <<'NODE'
import {fork} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'rifty-advanced-callback-'));
const file=join(dir,'child.cjs');
writeFileSync(file, `process.on('message', value => process.send(value));`);
const child=fork(file,[],{serialization:'advanced',stdio:'pipe',execArgv:[]});
const events=[];let invalidCallbacks=0;let callbackSync;let sync=true;
for(const [label,value] of [['undefined',undefined],['function',()=>{}],['nested-function',{bad(){}}]]){
 try{child.send(value,()=>{invalidCallbacks++});events.push(label+':NO_THROW')}
 catch(error){events.push(label+':throw:'+error.name+':'+(error.code??'no-code'))}
}
const returned=child.send({ok:true},error=>{callbackSync=sync;events.push('callback:'+String(error));});
sync=false;events.push('returned:'+returned);
child.on('message',()=>{events.push('message');console.log(process.version,JSON.stringify({events,invalidCallbacks,callbackSync}));child.kill();});
child.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
NODE
```

```text
v24.16.0 {"events":["undefined:throw:TypeError:ERR_MISSING_ARGS","function:throw:TypeError:ERR_INVALID_ARG_TYPE","nested-function:throw:Error:no-code","returned:true","callback:null","message"],"invalidCallbacks":0,"callbackSync":false}
```

Observed callback precedes echo in this run; no universal delivery-ack ordering
claim inferred. Callback async/null and no callback on synchronous validation
failure are recorded, not implemented here. Both rifty send APIs currently
reject callback/options with named `.send.arguments` ceilings (ADR-0326).
A forcing callback consumer discovered in the real Vitest run remains goal work.

## Carrier constraints and scope attribution

- Goal I4 default fork pool → advanced launch + generic rich IPC; native tests
  establish exact values/error behavior. No new user policy.
- Current child uses `#jsonIpc = launch.kind === 'program'`; initial draft's
  claim of an already non-JSON program sender was false. `#jsonIpc` also owns
  listener keepalive: separating codec selection must preserve IPC liveness.
- Both senders and both receive paths currently call JSON normalization.
  Choose one codec boundary; retain kernel MessagePort and public/private lanes.
- A direct `structuredClone({buffer: Buffer.from([1,2])})` probe on Node
  v24.16.0 gave `Buffer.isBuffer=false`, constructor `Uint8Array`; cloning
  `{bad(){}}` threw `DataCloneError` code 25. Advanced native fork instead
  preserves Buffer and throws `Error` without code. Raw pass-through is not
  the native serializer. Preserve graph aliases and exactly one getter read;
  metadata cannot collide with guest object keys.
- Clone/value validation occurs before the broad transport-disconnect catch;
  clone failure must not call the control-close path.
- ADR-0267/0326 exact typed launch → v5 migration (ADR-0446); both producer and
  receiver tests prove ownership. Existing v4-pinning tests require explicit
  protocol criterion migration under PR-4, not a compatibility reader.
- MessagePort alive excludes loss/duplicates/reorder; local bad values and
  public-disconnect/private-control retention are the relevant fault boundary.
  No transport recovery machinery added.

## Implementation proof — 2026-09-23

ADR-0446 implemented: v5 producer/reader; one mode-selected codec for Worker
and same-realm public senders/receivers. Advanced snapshots the rich graph once,
transports Buffer references in an outer runtime envelope, and restores brands
with shared/cyclic identity after MessagePort cloning. Guest `value`/`buffers`
keys cannot impersonate the envelope. Clone failure precedes transport catches.

Reviewer liveness concern: added independent
`child_process/public-ipc-advanced-listener.case.ts`; child has only a message
listener, parent waits 80 ms before sending, child replies and disconnects.
Pre-implementation RED: physical audit expected 1 Worker, constructed 0
(unchanged advanced ceiling). Native v24.16.0 output:

```text
{"events":["ready","received:bigint:42","disconnect"],"code":0,"signal":null,"connected":false}
```

Executed GREEN:

- `node --import tsx tools/node-parity-runner/src/cli.ts public-ipc`: all 4
  physical cases match Node (rich, fault, listener-only, existing default JSON).
- `pnpm exec vitest run packages/runtime-js/src/builtins/node-entry-advanced-ipc.test.ts packages/runtime-js/src/builtins/node-entry-runtime-config.test.ts packages/runtime-js/src/ipc/install-process-ipc.test.ts`: 4 + 61 + 15 PASS after version criteria migrated.
- `pnpm exec vitest run packages/runtime-js/src/builtins/child_process-worker-identity.test.ts packages/workbench/src/workers/workbench-project-runtime.test.ts tools/node-parity-runner/src/run-in-rifty.test.ts`: 10 + 201 + 48 PASS. Also requested legacy `tests/conformance/builtins/child_process-worker.test.ts`: its 2 opt-in tests skipped; they supply no acceptance proof.
- `pnpm exec vitest run packages/runtime-js/src/internal/node-ipc-advanced.test.ts`: 2 PASS. Native v8 differential caught an implementation fault first (Object.toString classification invoked a symbol accessor which native serialization ignores); explicit intrinsic classification fixes it. Outer-envelope collision case also passes.
- `pnpm check:arch`, `pnpm check:file-size`, `pnpm check:dir-owner`, targeted
  Biome check: PASS. IPC comment shortened without dropping its existing
  async-entry backlog limitation; process file ratchet holds.

PR-4 protocol criteria: replace active v4 expected strings/regexes with v5 in
bootstrap producer/reader and physical/workbench tests. Dedicated rejection
keeps an actual v4 envelope and requires mismatch. Historical v2/v3 rejection
semantics remain. Initial two old expected-error regex failures were rerun in
isolation after migration: all 61 config tests PASS.

The new caller-value boundary shares no retry, callback, delivery-ack or process
owner. Callback/handle/options ceilings remain unchanged. Whole-goal Vitest
acceptance is still the parent's required continuation.

Final targeted verification: `pnpm --filter @riftydev/runtime-js typecheck`,
`pnpm backlog:check`, `pnpm refs:check`, `git diff --check` → PASS. Earlier
typecheck failures were concurrent source-map/guard edits outside this unit;
latest run is green. No full pr:check run while other source work is active.
