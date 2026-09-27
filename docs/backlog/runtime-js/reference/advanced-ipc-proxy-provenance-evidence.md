# Advanced IPC Proxy provenance — 2026-09-23

Authority: existing advanced IPC acceptance rows 1/2 and ADR-0446; preserve
Buffer/getter semantics. Native exact Vitest census reported by the goal driver:
144 IPC messages, no accessors/Buffer/typed-array/Error/Proxy, cycles present.
The census alone does not force Proxy machinery; the retained generic promise
and executed native rejection defect do. No user scope amendment received.

## Native / physical RED

Node v24.16.0. Executed:

```sh
node --import tsx tools/node-parity-runner/src/cli.ts public-ipc-advanced-proxy
pnpm test:run packages/runtime-js/src/internal/node-ipc-advanced-vm-proxy.test.ts packages/runtime-js/src/builtins/module-builtin-array.test.ts
```

Physical case requires one real child Worker. Both Node senders:
`proxy`/`revocable` → `Error`, no code, `#<Object> could not be cloned.`;
`revoked` → `Error`, no code, `null could not be cloned.`; traps `[]`;
Buffer getter reads `1`, both controls `[true,[1,2,255]]`.
Native Proxy shape: `Proxy`, length `2`, no prototype; revocable own descriptor
identity true; intrinsic sources `function Proxy() { [native code] }`,
`function revocable() { [native code] }`, `function toString() { [native code] }`.

Rifty RED: first two sends `NO_THROW`; revoked `TypeError` from getPrototypeOf;
both senders invoke repeated prototype/keys/get traps. Global Buffer control
also failed: the disposable parent harness installed process/timers but left
native Node Buffer, while the child production installer installed rifty Buffer.
Repair at `run-in-rifty-worker.ts`: mirror real production Buffer/Proxy globals
before parent guest code. Original global-Buffer fixture and explicit-import
rich/getter fixtures remain unchanged; no Buffer.isBuffer broadening.

Unit RED: QuickJS-created live Proxy accepted; builtinModules has zero own
indices despite length 47. Native Node builtinModules: frozen dense length 72,
72 enumerable keys, own index 0, same array through `Module.builtinModules`.
Rifty originally: length 47, zero keys, not frozen, different Module reference;
codec produced 47 holes. Late registration changes list length (47→48), so
snapshot must refresh on registry contents rather than at module import.

## Realm/provenance sweep

14 original `new Proxy` sites, 10 runtime-js files; none in io/vfs:

- sandbox-toolchain-realm: descriptor/Memory/namespace (3)
- child_process-exec, source-maps, function-import-routing, fetch-keepalive (4)
- misc-stubs (1), module builtinModules (1)
- vm membrane: array/object/function (3), rewrite-engine context (1)
- quickjs-engine guest codeGeneration bootstrap (1)

12 host wrapper sites now use private RuntimeProxy; module's virtual array is
removed. QuickJS bootstrap remains a guest-realm follow-on, not a host site.
No worker_threads/MessagePort edits in this repair.

Disposable reflection probe `/private/tmp/rifty-proxy-tracking-probe.mjs`:
native/facade snapshots agree for new/apply errors, name/length/prototype/own
descriptors, revocable identity/revocation, newTarget, native toString and freeze.
Bare facades fail toString; get-only revocable interception fails descriptor
identity. Existing QuickJS codeGeneration uses the same toString delegation.
Captured primordials/other realms evade a mere global WeakSet; product wrappers
must retain their semantic provenance. For known Proxy inputs, native clone
matches v8 error text for 12 live/revoked object/array/function/Date/Map/Buffer
variants without traps.

## Host portion GREEN

- Physical advanced parity: four `public-ipc-advanced*` cases match Node.
- Fresh Chromium `owner-advanced-ipc-proxy.spec.ts`: first RED exposed
  `Failed to execute 'structuredClone' on 'WorkerGlobalScope': ` prefix;
  production normalization then GREEN (1/1). Buffer/getter controls unchanged.
- Unit: module array, existing codec, Function routing, process IPC 28/28.
- Owner bootstrap control 1/1: duplicate source copies share primordial and
  tracking, runtime wrappers unmarked, acquisition sealed, WeakSet prototype
  tampering cannot disable recorded-proxy rejection.
- runtime-js tsc and source-file size gates pass; no pin increases.

## Required VM follow-on — not closed

`node-ipc-advanced-vm-proxy.test.ts` remains RED. Production membrane changes
so far are only private RuntimeProxy construction; no eager guest metadata
bootstrap is installed yet. Proposed ingress is proven only by disposable
`/private/tmp/rifty-quickjs-proxy-metadata-probe.mts`: globals unchanged, zero
Proxy traps, private metadata distinguishes ordinary/Proxy/revoked handles,
host-origin identity and both wrapper roundtrips preserved, captured methods
survive prototype tampering, ContextLifetime disposal clean. Current revoked
guest Proxy wrapping still throws `TypeError: revoked proxy` before send.

Exact exotic-loss probe retained at
`/private/tmp/rifty-vm-advanced-codec-probe.mts`, executed:

```sh
node --import tsx /private/tmp/rifty-vm-advanced-codec-probe.mts
```

It explicitly calls `setVmEngineOverride('quickjs')`, awaits
`ensureVmEngineReady()`, compares native
`deserialize(serialize(nativeVm.runInNewContext(source)))` with rifty
`deserializeNodeIpcMessage(structuredClone(serializeNodeIpcMessage(vm.runInNewContext(source), 'advanced')), 'advanced')`.

```text
v24.16.0 engine=quickjs
new Map([["x",1]]) {"nodeBrand":"[object Map]","riftyBrand":"[object Object]","nodeEntries":[["x",1]],"riftyKeys":[]}
new Set([1,2]) {"nodeBrand":"[object Set]","riftyBrand":"[object Object]","nodeEntries":[1,2],"riftyKeys":[]}
new Date(0) {"nodeBrand":"[object Date]","riftyBrand":"[object Object]","riftyKeys":[]}
new Uint8Array([1,2]) {"nodeBrand":"[object Uint8Array]","riftyBrand":"[object Uint8Array]","riftyKeys":["0","1"]}
```

These are executed silent-loss observations, not inferred universal VM coverage.
The driver retains them as required current IPC work under the unchanged scope.

Codec boundary: native `vm.runInNewContext` Map/Set/Date and severed prototypes
also lost slots through `instanceof` dispatch. Added two differential cases in
`internal/node-ipc-advanced.test.ts`: RED `expected {} to be an instance of Map`,
then captured native slot readers replace those three realm-local checks.
Both pass, including cycles and object-key aliases. Existing two codec tests,
four physical advanced IPC parity cases and runtime-js tsc also pass. VM carrier
repair remains separate; this does not certify its implementation.


## VM completion and independent boundary assessment

VM private eager metadata, zero-trap Proxy/revoked rejection, real Map/Set
backings/cycles, and Error cause descriptors implemented. Targeted VM tests:
54 pass, 4 existing skips; guard reverts reproduce9 Proxy failures and3
collection failures. Existing vm/ parity32/32 passes. Native and QuickJS
codec tests24/24 pass after class sweep: Date/Map/Set/RegExp/Error, real
ArrayBuffer and boxed primitive slots. Node24 and Chromium148 expose native
Error.isError; it recognizes real Error backing without guest tag getters.
Error message/cause accessors are ignored by native serialization (reads0);
prior codec read both. Data descriptors now preserve cause cycles/aliases.
Formatting native clone failures no longer coerces the rejected value.

Independent read-only codex review, session01a0cc0d-a8b7-78a1-a2b2-873d0d1bffaa,
re-ran original probes and boundary controls. Ruling: advanced IPC Acceptance1
owns the actual input to send, not reconstruction of state already lost at a
VM return boundary. Real intrinsic codec losses remain FIX and were repaired.
VM missing exotic mirrors and retained-mirror mutations are separate baseline
residuals, with explicit public ❌ and owner/trigger drafts. Error.cause was
also a baseline omission, but the bounded descriptor repair landed here.
No guest-refresh was added: reviewer verified host Map write x=3 is retained
at send while subsequent x=4 does not change the sent snapshot; refreshing
from guest would incorrectly erase x=3.

Reproduce both residual classes from repository root (Node v24.16.0):

```sh
node --import tsx --input-type=module <<'JS'
import native from 'node:vm';
import vm from './packages/runtime-js/src/builtins/vm/index.ts';
import {setVmEngineOverride} from './packages/runtime-js/src/builtins/vm/engine-config.ts';
import {ensureVmEngineReady} from './packages/runtime-js/src/builtins/vm/quickjs-loader.ts';
setVmEngineOverride('quickjs'); await ensureVmEngineReady();
console.log(process.version);
for(const source of ['new ArrayBuffer(4)','new DataView(new ArrayBuffer(4))','Object(true)','Object(3)','Object("x")']) {
 console.log(source,...[native,vm].map(engine=>Object.prototype.toString.call(engine.runInNewContext(source))));
}
for(const [source,mutation,read] of [
 ['new Map([["x",1]])','x.set("x",2)',x=>JSON.stringify([...x])],
 ['new Set([1])','x.add(2)',x=>JSON.stringify([...x])],
 ['new Date(0)','x.setTime(123)',x=>String(x.getTime())],
 ['[1]','x.push(2)',x=>JSON.stringify(x)]
]) {
 console.log(source,...[native,vm].map(engine=>{const c=engine.createContext({});const x=engine.runInContext('var x='+source+';x',c);engine.runInContext(mutation,c);return read(x)}));
}
JS
```

Native brands: ArrayBuffer/DataView/Boolean/Number/String; rifty: Object for all5.
Retained values: Map [[x,2]] versus [[x,1]], Set [1,2] versus [1], Date123
versus0, Array[1,2] versus[1]. These are explicit VM gaps, not GREEN carriers.
