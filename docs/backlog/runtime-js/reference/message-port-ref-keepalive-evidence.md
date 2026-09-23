# MessagePort manual refs — Contract+RED, 2026-09-23

New I4-required class from actual Vitest-main tracing; I2 remains unchanged.
No production code in this preparation.

## Observed package path

Exact unpacked `@emnapi/runtime@1.10.0`:
`/private/tmp/rifty-emnapi-inspect/runtime/package/dist/emnapi.cjs.js`.
At 120 it selects global MessageChannel before a worker_threads fallback. At
1182–1205 NodejsWaitingRequestCounter creates `new _MessageChannel().port1`,
refs on count 0→1 if ref exists, unrefs on 1→0 if unref exists. Context's
increase/decreaseWaitingRequestCounter delegate at 1316–1322.

Driver artifacts `/private/tmp/rifty-vitest-lifetime-trace2.log` and package
inspection establish: WebAssembly compilation/instantiation completed; rolldown
onCreateWorker and emnapi threadSpawn intentionally unref their Worker; the
separate NAPI port lacks ref/unref in Chromium. No Worker-ref override or
package-specific startup Promise can replace this handle.

## Native oracle

Shared complete parent/child sources:
`tests/browser-unit/fixtures/message-port-keepalive-cases.ts`.

```sh
node --import tsx --input-type=module <<'NODE'
import {messagePortKeepaliveCases} from './tests/browser-unit/fixtures/message-port-keepalive-cases.ts';
import {nativeWorkerLifecycle} from './tests/browser-unit/fixtures/worker-lifecycle-oracle.ts';
console.log(process.version);
for(const c of messagePortKeepaliveCases)console.log(c.name,JSON.stringify(await nativeWorkerLifecycle(c)));
NODE
```

Node v24.16.0, code 0 and empty stderr for every supported case:

```text
global-and-builtin-channel-alias:
PORT|alias={"same":true,"ref":"function","unref":"function","hasRef":"function"}
PORT|parent-exit=0

manual-ref-holds:
PORT|late-message
PORT|parent-exit=0

idempotent-unref-drains:
PORT|initial=false
PORT|ref-returns=["undefined","undefined"]
PORT|referenced=true
PORT|unref-return=undefined
PORT|unreferenced=false
PORT|parent-exit=0

default-infrastructure-remains-unrefed:
PORT|parent-exit=0

own-close-transition / peer-close-transition:
PORT|close={"sync":true,"microtask":true,"immediate":true,"close":false,"refReturn":"undefined","refAfterClose":false,"closes":1,"code":0}

queued-message-before-peer-close:
PORT|queued={"samePort":true,"nativePort":true,"text":"queued","bytes":[3,7,11],"refAtMessage":true,"syncBeforeMessage":true,"microtaskBeforeMessage":true,"messageBeforeClose":true,"immediateBeforeClose":true,"closes":1,"hasRefAfterClose":false}

array-buffer-transfer-remains-native:
PORT|detached=true
PORT|buffer=[2,5,9]
PORT|parent-exit=0
```

Own close is asynchronous too: direct probe `port.ref(); port.close();
console.log(port.hasRef(), port.ref(), port.hasRef())` printed
`true undefined true`; the close callback sees false and cannot ref it again.

Queued message and setImmediate may swap order. Three native probe runs gave:

```text
sync → microtask → immediate → message(queued,true) → close(false) → ref-after-close(false)
sync → microtask → message(queued,true) → immediate → close(false) → ref-after-close(false)
sync → microtask → message(queued,true) → immediate → close(false) → ref-after-close(false)
```

The fixture asserts only the common partial order, not a fabricated total order.

## Chromium primitive probe

Executed Playwright Chromium 148.0.7778.96 on an about:blank page and a real
Blob dedicated Worker, independently of rifty:

```sh
node --input-type=module <<'NODE'
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
try {
 const page = await browser.newPage();
 const result = await page.evaluate(async () => {
  async function probe() {
   const {port1,port2}=new MessageChannel(); const events=[];
   for(const [name,port] of [['one',port1],['two',port2]]) {port.addEventListener('close',()=>events.push(name+':close'));port.start();}
   const shape={hasClose:'onclose' in port1,ref:typeof port1.ref,unref:typeof port1.unref,hasRef:typeof port1.hasRef};
   port2.close();events.push('after-close');await new Promise(r=>setTimeout(r,100));
   port1.close();await new Promise(r=>setTimeout(r,100));return {shape,events};
  }
  const pageResult=await probe();
  const url=URL.createObjectURL(new Blob(['('+probe.toString()+')().then(postMessage)'],{type:'text/javascript'}));
  const worker=new Worker(url);
  const workerResult=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=reject;});
  worker.terminate();URL.revokeObjectURL(url);return {page:pageResult,worker:workerResult};
 });
 console.log(browser.version(),JSON.stringify(result));
}finally{await browser.close()}
NODE
```

```text
148.0.7778.96 {"page":{"shape":{"hasClose":false,"ref":"undefined","unref":"undefined","hasRef":"undefined"},"events":["after-close"]},"worker":{"shape":{"hasClose":false,"ref":"undefined","unref":"undefined","hasRef":"undefined"},"events":["after-close"]}}
```

No close event observed in either 100ms window; these waits are probe deadlines,
NOT a proposed production close detector. A separate native Chromium probe
`peer.postMessage('queued'); peer.close()` delivered the real queued message
(sync → microtask → message), with no close notification in the same window.
Thus close must be backed by intercepted local native closure, not assumed
browser support or elapsed-time inference about a remote peer.

## Transfer boundary

Native Node supports ownership transfer; the bounded browser counter does not
claim remote peer-close evidence. Executed reference:

```sh
node <<'NODE'
const p=new MessageChannel();p.port1.ref();const b=new ArrayBuffer(4);
const copy=structuredClone({port:p.port1,buffer:b},{transfer:[p.port1,b]});
console.log(process.version,JSON.stringify({bufferDetached:b.byteLength===0,sourceHasRef:p.port1.hasRef(),targetPort:copy.port instanceof MessagePort,receivedBuffer:copy.buffer.byteLength}));
copy.port.close();p.port2.close();
NODE
```

```text
v24.16.0 {"bufferDetached":true,"sourceHasRef":true,"targetPort":true,"receivedBuffer":4}
```

Chosen unsupported outcome instead: MessagePort.transfer.managed before any
port or ArrayBuffer detachment. Browser ceiling test covers native port
postMessage and structuredClone; raw kernel init-port transfer is crossed by
the real unref'd Worker control. Plain ArrayBuffer transfer has native parity.
Implementation must cover its other exposed native transfer entry points too,
not silently allow ownership escape through a sibling carrier.

## Executed RED

```sh
RIFTY_PLAYGROUND_PORT=5415 pnpm test:browser-unit tests/browser-unit/message-port-keepalive.spec.ts
```

Fresh browser-unit server, reuseExistingServer:false, checkout playground;
`/private/tmp/rifty-message-port-final-red.log`: 9 RED, 1 control PASS, 13.8s.

- manual-ref-holds: optional ref skipped, only parent-exit=0; late message lost.
- alias: constructors equal today, but ref/unref/hasRef missing.
- manual API/close/queued/buffer cases: TypeError on missing ref/hasRef, exit 1.
- managed-transfer ceiling: missing ref aborts before claimed named boundary.
- shared primordial owner: getKernelHostMessageChannel absent.
- default-infrastructure control: PASS, unref'd Worker does not pin its parent.

The dual-module case imports shared-globals again after public shim installation,
and repeats the actual runtime compatibility installer: it will reject a second
bundle recapturing the wrapped global and double installation. A per-module
constructor constant is insufficient; both kernel and runtime need the same
realm-shared primordial owner before replacement (ADR-0452).

## Preparation boundary

No prototype patch, channel wrapper, ref registry, kernel API or emnapi change
implemented. ADR-0452 records selected local-pair/transfer boundary and candidates.
Independent Contract+RED remains required before product edits.

Dedup/sweep: runtime-js Worker lifecycle covers Worker/parentPort, not native
standalone ports; keepalive-residual-gaps covers fetch/backstop; perf-worker-
reexports concerns constructor re-exports. Backlog/map, ADR index/declined rows
and process traps contain no existing standalone manual-port ref owner.
MessageChannel allocation sweep found kernel/spawn-worker.ts and the eager
runtime timers channel; this motivates one shared primordial owner rather than
a third independent capture. Existing event-loop-keepalive remains the only
refcount/drain owner; kernel receives no Node-specific port-reference policy.

## Implementation proof, 2026-09-23

Contract+RED accepted at `9836df2e0`; implementation uses ADR-0452's shared
primordial constructor, real native pair registry and existing drain counter.
Only manual refs count. Intercepted local close waits queued native messages and
the check-phase checkpoint; no timer infers remote closure. Managed transfer is
checked before native serialization; raw kernel ports remain transferable.

C1 strengthened: after both refused transfer calls, the original managed port
must receive `[4,8,12]` from its original peer. The native detach mutant
`/private/tmp/rifty-message-port-detach-mutant-c1.mjs` passes the former state-only
assertion (`hasRef` remains true after actual detach), then fails the new byte
assertion (`null` versus `[4,8,12]`). Thus original endpoint ownership is observed.

An additional preservation regression uses Set transfer lists, frozen options,
a getter read once, and frozen structuredClone options. Real Node passes;
initial shim RED on fresh 5417: Set.prototype.values incompatible receiver.
The common transfer normalization now snapshots the actual iterable once and
uses a fresh options facade, avoiding frozen caller-property Proxy invariants.
Certified lifecycle/transfer assertions remain unchanged.

```sh
RIFTY_PLAYGROUND_PORT=5417 pnpm test:browser-unit tests/browser-unit/message-port-keepalive.spec.ts
pnpm test:run packages/runtime-js/src/ipc/worker-realm-compat.test.ts packages/runtime-js/src/builtins/worker_threads.test.ts packages/runtime-js/src/internal/event-loop-keepalive.test.ts packages/kernel/src/shared-globals-binary-sync.test.ts
pnpm exec tsc --noEmit --project packages/runtime-js/tsconfig.json
pnpm exec tsc --noEmit --project packages/kernel/tsconfig.json
```

Fresh server (`reuseExistingServer:false`), 11/11 Chromium PASS, 10.6s;
62/62 unit PASS; both package typechecks PASS. Logs:
`/private/tmp/rifty-message-port-final-green.log`,
`/private/tmp/rifty-message-port-unit.log`,
`/private/tmp/rifty-message-port-types.log`,
`/private/tmp/rifty-message-port-kernel-types.log`.
Transfer RED: `/private/tmp/rifty-message-port-transfer-red.log`.

Root's separate fresh5419 Vitest diagnostic now reaches thread startup and
fails the named Worker.execArgv ceiling; this is not full Vitest acceptance.
Full goal proof and independent Final+GREEN remain parent-owned.

## Final-review B1 repair, 2026-09-23

Independent review `a728f986a` found the dictionary facade delegating
Symbol.iterator back to its caller after overload selection. A changing getter
made native postMessage consume an unchecked iterable: managed endpoint and
companion buffer detached. The same second read broke ordinary buffer options
whose getter only permits one access. Fault class: provenance-lie ×
ownership-losing transfer; observable-order × option getters.

Executed new regression before repair:

```sh
RIFTY_PLAYGROUND_PORT=5434 pnpm test:browser-unit tests/browser-unit/message-port-transfer-options.spec.ts
```

Fresh5434: 3 RED (MessagePort, native Worker, worker-global), 1 structuredClone
control PASS. Actual native Chromium runs precede the installed shim in each
case. Native reads once, raises DataCloneError without detaching, retains peer
bytes `[4,8,12]`; bad shim reads three times, sends, detaches both, loses bytes.
Ordinary buffer native transfer reads once and delivers `[2,5,9]`; bad shim
reads twice and throws. Node24 executed reference agrees:
`/private/tmp/rifty-message-port-b1-native.mjs` and `-native.log`.
RED: `/private/tmp/rifty-message-port-b1-red.log`.

Repair: preserve the selected iterator value in the fresh dictionary facade;
native overload selection cannot re-open the original getter. Non-callable
iterators retain native early TypeError without touching the transfer getter.
No new transfer protocol or per-carrier registry. One normalizer covers all
three affected entry points; structuredClone remains the dictionary-only
control. Existing Set/frozen-options/getter and managed-byte guards unchanged.

```sh
RIFTY_PLAYGROUND_PORT=5434 pnpm test:browser-unit tests/browser-unit/message-port-transfer-options.spec.ts tests/browser-unit/message-port-keepalive.spec.ts
pnpm test:run packages/runtime-js/src/ipc/worker-realm-compat.test.ts packages/runtime-js/src/builtins/worker_threads.test.ts packages/runtime-js/src/internal/event-loop-keepalive.test.ts packages/kernel/src/shared-globals-binary-sync.test.ts
pnpm exec tsc --noEmit --project packages/runtime-js/tsconfig.json
```

Fresh5434: 15/15 browser PASS, 11.7s; 62/62 related unit PASS; runtime-js
typecheck PASS. Final carrier also verifies invalid-iterator rejection reads
no transfer getter; live native and installed results match on all entry points.
Logs `/private/tmp/rifty-message-port-b1-{green,unit,types}.log`.
Same independent reviewer must verify the repaired source; no full-goal claim.
