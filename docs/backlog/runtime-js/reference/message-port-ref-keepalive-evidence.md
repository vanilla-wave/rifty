# message-port-ref-keepalive — evidence (PICKUP + Contract+RED, 2026-09-23)

Unit: `docs/backlog/runtime-js/message-port-ref-keepalive.md`. Decision: ADR-0447.
BASE `325ae797c`. Oracle host: Node v24.16.0, npm 11.17.0 (macOS arm64).
Browser: Playwright Chromium 148.0.7778.96.

## Versions — scenario tree

`npm install --package-lock-only` on the goal's scenario manifest
(`{"devDependencies":{"vitest":"4.1.11"},"overrides":{"vite":"8.0.16"}}`), npm 11.17.0:

```text
node_modules/@emnapi/core 1.10.0
node_modules/@emnapi/runtime 1.10.0
node_modules/@emnapi/wasi-threads 1.2.1
node_modules/@napi-rs/wasm-runtime 1.2.3
node_modules/@rolldown/binding-wasm32-wasi 1.0.3
node_modules/rolldown 1.0.3
node_modules/vite 8.0.16
node_modules/vitest 4.1.11
```

The oracle tree is that install plus `npm install --no-save --force
@rolldown/binding-wasm32-wasi@1.0.3` (the macOS host skips the wasm32 optional
dependency). Its `dist/emnapi.cjs.js` is byte-identical to `npm pack
@emnapi/runtime@1.10.0` (`cmp` → equal). The browser `vite8` template snapshot
(`apps/playground/public/snapshots/vite8-node-modules.json.gz`, lockfile) has the
same rolldown 1.0.3, `@rolldown/binding-wasm32-wasi` 1.0.3 and `@emnapi/runtime`
/ `@emnapi/core` 1.10.0; only `@napi-rs/wasm-runtime` differs (1.1.6).

## Package path

`@emnapi/runtime@1.10.0` `dist/emnapi.cjs.js` (from `npm pack`):

- :120-128: `_MessageChannel` is the global `MessageChannel` if there is one,
  otherwise `require('worker_threads').MessageChannel`. It is captured when the
  module loads.
- :1182-1205: `NodejsWaitingRequestCounter`, where `refHandle = new
  _MessageChannel().port1`. `increase()` at count 0 calls
  `if (this.refHandle.ref) this.refHandle.ref()`. `decrease()` at count 1 calls
  `if (this.refHandle.unref) this.refHandle.unref()`.
- :1229-1230: the counter is created only when `process.once` is a function (as
  in rifty).
- :1316-1322: `increase/decreaseWaitingRequestCounter` delegate to it.

`@rolldown/binding-wasm32-wasi@1.0.3` `rolldown-binding.wasi.cjs:64-90`
(`onCreateWorker`): it replaces `ref` on the Worker's `Symbol(kPublicPort)` and
`Symbol(kHandle)` with no-ops, then calls `worker.unref()`. Its comment says
Rust threads must never hold Node.

`@emnapi/core@1.10.0` `dist/emnapi-core.cjs.js:4451-4453, 7032-7034`
(`napi_create_external_arraybuffer`, `napi_detach_arraybuffer`): creates a fresh
`new MessageChannel()` and calls `port1.postMessage(buf, [buf])` to detach an
ArrayBuffer. This path needs native transfer, and these ports are never
referenced.

## Holder — map open question answered (Node control)

On BASE a rifty `vitest run` fails earlier, at the I6 walls (`node:path/posix`,
…), so an instrumented rifty run cannot reach the config bundle. Instead, the
holder is isolated in real Node. A preload makes only the ports of the GLOBAL
`MessageChannel` (what emnapi captures) browser-shaped. Node internals are
untouched:

```js
// browser-shaped-global-ports.cjs
const NativeMessageChannel = MessageChannel;
globalThis.MessageChannel = class MessageChannel extends NativeMessageChannel {
  constructor() {
    super();
    for (const port of [this.port1, this.port2]) {
      for (const key of ['ref', 'unref', 'hasRef']) Object.defineProperty(port, key, { value: undefined });
    }
  }
};
```

Scenario project in the oracle tree (goal §User scenario files):

```sh
NAPI_RS_FORCE_WASI=1 node node_modules/vitest/vitest.mjs run                      # reference, ×2
NAPI_RS_FORCE_WASI=1 node --require ./browser-shaped-global-ports.cjs node_modules/vitest/vitest.mjs run   # control, ×3
```

```text
reference run 1 exit=1  " RUN  v4.1.11 …"  " Test Files  1 failed (1)"  "      Tests  1 failed | 1 passed (2)"
reference run 2 exit=1  (same)
control run 1 exit=0 stdout-bytes=0 stderr-lines-non-warning=0
control run 2 exit=0 stdout-bytes=0 stderr-lines-non-warning=0
control run 3 exit=0 stdout-bytes=0 stderr-lines-non-warning=0
```

The only stderr in the control is Node's `ExperimentalWarning: WASI`, and rifty
prints no such warning. With it removed, this is I4's silent exit: exit 0 and
empty output, in real Node, with emnapi's port as the only change. Invalid
control, not used: `delete MessagePort.prototype.ref` breaks Node's own
internal `port.unref()` calls, which leaves internal ports referenced and hides
the effect.

## Real package — detached rolldown

`src/entry.js` = `export const answer = 6 * 7;\nconsole.log(answer);\n`.
The sources are the ones in `tests/browser-unit/message-port-ref-keepalive.spec.ts`
(`rolldown-detached.mjs`: static import, `console.log('ROLLDOWN|start')`, then
`rolldown({input:'./src/entry.js',logLevel:'silent'}).then(b => b.generate({format:'esm'})).then(print)`
with no top-level await; `rolldown-awaited.mjs`: the same build with top-level
await). Run in bash, 3 runs each, `NAPI_RS_FORCE_WASI=1 perl -e 'alarm 60; exec @ARGV' node [--require ./browser-shaped-global-ports.cjs] <file>`:

```text
== rolldown-detached reference run 1..3 (v24.16.0): exit=0
ROLLDOWN|start
ROLLDOWN|chunks=1|entry=entry.js|code="//#region src/entry.js\nconst answer = 42;\nconsole.log(42);\n//#endregion\nexport { answer };\n"
== rolldown-detached control run 1..3: exit=0
ROLLDOWN|start
== rolldown-awaited reference run 1..3: exit=0
ROLLDOWN|awaited|chunks=1|entry=entry.js
== rolldown-awaited control run 1..3: exit=13
Warning: Detected unsettled top-level await at file:///…/rolldown-awaited.mjs:3
const out = await bundle.generate({ format: 'esm' });
```

In Node, even an awaited `generate()` relies on emnapi's port. Rifty's kernel
waits for a pending entry promise, so the awaited variant is the rifty-side
precondition (the binding loads and bundles). The detached variant is the RED.

## Claimed-path sweep — no other MessagePort reference use

`grep -rln -E "MessageChannel|MessagePort|\.hasRef\(" --include=*.{js,mjs,cjs}` over
the scenario `node_modules`:

```text
vitest/dist/chunks/index.DC7d2Pf8.js   globals name list only
vitest/dist/chunks/test.DNmyFkvJ.js    fake timers (2205-2215): onmessage + close, unclaimed
vitest/dist/chunks/native.DPzPHdi5.js  port.unref + port.on('message'), only when experimental.viteModuleRunner === false (base.B6Opl8PE.js:143-145), unclaimed
vitest/dist/chunks/index.DXx9Dtk7.js   hanging-process reporter (async_hooks resource.hasRef), unclaimed
vite/dist/node/chunks/node.js          WorkerWithFallback (2941-2993: port.on + unref) for css preprocessors/terser, not on the .ts test path
@vitest/utils/dist/serialize.js        comment only
why-is-node-running/index.js           unclaimed reporter
```

The claimed path needs manual `ref`/`unref` only. No listener-driven referencing
is reached.

## Oracle cases (live in the spec; captured here)

Command (repo root, this unit's fixture):

```sh
node --import tsx --input-type=module -e "
import { messagePortRefCases, refcountIsolationCase, runNodeOracle } from './tests/browser-unit/fixtures/message-port-ref-cases.ts';
for (const c of [...messagePortRefCases, refcountIsolationCase]) { const r = await runNodeOracle(c.source); console.log('##', c.name, r.version, 'code=' + r.code, 'stderr=' + JSON.stringify(r.stderr)); console.log(r.stdout.trimEnd()); }"
```

Output (5 more runs byte-identical, `cmp`):

```text
## api-shape v24.16.0 code=0 stderr=""
PORT|alias=true
PORT|constructor=true,true,MessageChannel,0
PORT|native=true
PORT|types=function,function,function,function
PORT|fresh=false,false,false
PORT|ref-return=undefined
PORT|referenced=true,false
PORT|unref-return=undefined
PORT|double-ref-single-unref=false
PORT|builtin-ref=true
PORT|builtin-unref=false
PORT|illegal=TypeError:Illegal invocation,TypeError:Illegal invocation,TypeError:Illegal invocation
## reference-holds-until-unref v24.16.0 code=0 stderr=""
PORT|start
PORT|late=timed-out,true,false,false
PORT|after-unref=false
## emnapi-waiting-request-counter v24.16.0 code=0 stderr=""
PORT|queued=2
PORT|done=a,count=2
PORT|done=b,count=1
## close-releases v24.16.0 code=0 stderr=""
PORT|before-close=true
## peer-close-releases v24.16.0 code=0 stderr=""
PORT|after-peer-close=false,false
## ref-after-close-does-not-hold v24.16.0 code=0 stderr=""
PORT|ref-return=undefined
PORT|closed-ref=false,false
## unreferenced-transfer-stays-native v24.16.0 code=0 stderr=""
PORT|detached=0,reads=1
PORT|clone=true,true
PORT|received=true,true,1.2.3
PORT|through-transferred=ping
## refcount-isolation v24.16.0 code=0 stderr=""
PORT|late=true
PORT|released=false
PORT|timer
```

`transferCeilingCase` has no Node rows. Node has no global `Worker` or
`postMessage`, and it allows every transfer the case attempts (§Node probes,
`p10`). Its expected rows are ADR-0447's named outcome.

## Node probes (v24.16.0; scripts `node <file>` under a 2–3 s alarm)

Shape and descriptors:

```text
$ node p1-shape.cjs
{"node":"v24.16.0","sameChannel":true,"samePort":true,"isPort":true,"ref":"function","unref":"function","hasRef":"function","on":"function","addEventListener":"function","protoRef":true,"protoHasRef":true,…,"fresh":false,"refRet":"undefined","afterRef":true,"refRet2":"undefined","unrefRet":"undefined","afterUnref":false,"peerFresh":false}
$ node -e '…getOwnPropertyDescriptor(MessagePort.prototype, k)…'
ref {"w":true,"e":true,"c":true,"type":"function","name":"ref","length":0}
unref {"w":true,"e":true,"c":true,"type":"function","name":"unref","length":0}
hasRef {"w":true,"e":true,"c":true,"type":"function","name":"hasRef","length":0}
close {"w":true,"e":true,"c":true,"type":"function","name":"close","length":1}
ref-on-object TypeError undefined Illegal invocation
NodeEventTarget: setMaxListeners,getMaxListeners,eventNames,listenerCount,off,removeListener,on,addListener,emit,once,removeAllListeners
```

Hold/release (`p2`: `port1.ref()` only; `p3`: `ref(); unref()`; `p4`: fresh):

```text
p2-ref-holds   RESULT killed-by-timeout(2s)
p3-ref-unref   exit-event 0            RESULT exit=0 elapsed=71ms
p4-fresh       exit-event 0 false      RESULT exit=0 elapsed=61ms
```

`Atomics.waitAsync` holds nothing (`p5`), and a referenced port holds it (`p6`):

```text
p5  async true / exit-event 0                      RESULT exit=0 elapsed=52ms   (no 'late')
p6  late timed-out true / after-unref false / exit-event 0   RESULT exit=0 elapsed=383ms
```

Listener referencing (`p7`, the explicit gap):

```text
v24.16.0 {"addEventListener":true,"onmessage":true,"onmessageNull":false,"on":true,"off":false,"removeOneOfTwo":true,"removeLast":false,"messageerror":false,"closeListener":false,"startOnly":false,"listenerThenUnref":false,"unrefThenListener":true,"secondListenerAfterUnref":false,"manualRefThenListenerRemoved":false,"once":true,"dupAddOneRemove":false,"abortSignalRemove":false}
```

Close timing (`p8 own|peer`: ref'd port, `close()` on own/peer side; `p9`):

```text
v24.16.0 own  ["sync:true","microtask:true","immediate:true","port-close-event:false","ref-in-close:false","peer-close-event","timeout0:false"] code 0
v24.16.0 peer ["sync:true","microtask:true","immediate:true","peer-close-event","port-close-event:false","ref-in-close:false","timeout0:false"] code 0
v24.16.0 {"closedThenRef":["undefined",true],"closeTwice":true,"unrefAfterClose":false,"peerRefSyncAfterClose":true}
```

Transfer (`p10`):

```text
clone-refd              copy.hasRef false src.hasRef true … exit 0 src.hasRef false   (transfer closes the source)
clone-refd-copyref      late copy.hasRef true, killed at 3 s                         (the received copy is a fresh handle)
post-refd               received port true false … exit 0
peer-transferred-close  imm port1.hasRef true … exit 0 src.hasRef false               (closing the transferred peer releases)
```

## Terminal drain has no cap (design constraint)

`packages/workbench/src/workers/node-entry-bootstrap.ts` (serve branch, the
terminal `node <file>` path) calls
`awaitDrain({ capMs: Number.POSITIVE_INFINITY, hasRef: … })`. The ADR-0152 §4
30 s cap applies only to the `.bin`/execSync branch, through the kernel drain
hook. Executed on BASE with a throwaway browser-unit probe (not committed):
`node main.cjs` with `setInterval(() => {}, 1000); console.log('PORT|interval')`,
under a 90 s race:

```text
CAP-PROBE {"timedOut":true,"exit":null,"out":"PORT|interval\n","elapsedMs":90023}
```

So on the terminal path, a referenced port whose release rifty cannot see
holds forever. That is why ADR-0447 records pairs and refuses split
transfers, and does not rely on the cap.

`MessagePort#postMessage` return value (not changed by this unit):

```text
$ node -e "const {port1}=new MessageChannel(); console.log(process.version, 'postMessage returns', port1.postMessage('x')); port1.close()"
v24.16.0 postMessage returns true
$ (Playwright chromium page) port1.postMessage('x') → {"postReturn":"undefined"}   148.0.7778.96
```

## Chromium 148 (no rifty)

`node .u13-chromium-close.mjs` (Playwright chromium, about:blank page and a Blob
dedicated Worker; port2.close() then a 200 ms wait; structuredClone transfer
probe):

```text
148.0.7778.96 {"page":{"shape":{"onclose":false,"ref":"undefined","unref":"undefined","hasRef":"undefined","on":"undefined"},"events":["after-close"],"detached":{"postAfter":"ok","closeAfter":"ok","retransfer":"DataCloneError:Failed to execute 'structuredClone' on 'Window': Port at index 0 is already neutered.","copyIsPort":true},…},"worker":{…same…},"waitAsync":"function"}
```

There is no `close` event, and a neutered port's `postMessage`/`close` are silent
no-ops. The only way to detect neutering is a destructive re-transfer. So a
release on the far side of a transfer cannot be observed. A same-realm pair
close can be seen only by wrapping `close()` (ADR-0447 §3–4).
`Atomics.waitAsync` exists in the realm.

## RED (Contract+RED preparation, no product change)

```sh
RIFTY_PLAYGROUND_PORT=5413 pnpm test:browser-unit tests/browser-unit/message-port-ref-keepalive.spec.ts tests/browser-unit/message-port-ref-keepalive.fault.spec.ts
```

Fresh dev server (`reuseExistingServer:false`), 10/10 fail on BASE `325ae797c`:

```text
1) fault: one port contributes exactly zero or one keepalive hold
   TypeError: redundant.ref is not a function; rows − 5 / + 1
2) fault: transfers that would hide a referenced port release fail by name
   received only "PORT|worker=function" (a native Worker can be created in the realm), then
   TypeError: held.ref is not a function; missing all 11 named-outcome rows
3) api-shape                         PORT|alias=true, then TypeError: port.hasRef is not a function; − 9 rows
4) reference-holds-until-unref       received ["PORT|start"]; missing late/after-unref rows (exit 0)
5) emnapi-waiting-request-counter    received ["PORT|queued=2"]; missing done=a/done=b rows (exit 0)
6) close-releases                    TypeError: port.ref is not a function; − 3 rows
7) peer-close-releases               TypeError: port.ref is not a function; − 3 rows
8) ref-after-close-does-not-hold     Uncaught TypeError: port.ref is not a function (/main.cjs:8); − 4 rows
9) unreferenced-transfer-stays-native TypeError: holder.ref is not a function; − 6 rows
10) detached rolldown (vite8 template) precondition rolldown-awaited PASSED (row + exit 0);
    detached: "exit=0\nROLLDOWN|start", missing the bundle row
```

Cases 4, 5 and 10 fail on the drained wait itself: exit 0, no exception, and
the late rows are missing. That is I4's silent exit, reproduced here with the
real packages. The other cases fail because the API is missing. An earlier RED
run (before the pair/transfer revision) failed the same eight shared cases the
same way.

## Probe sources (verbatim)

Node probes ran as `node <file> [mode]` (`p8` modes `own`/`peer`; `p10` modes as printed) under `perl -e 'alarm N; exec @ARGV'`. The Chromium probe ran from the repo root, so `@playwright/test` resolves.

- `p2-ref-holds.cjs`: `const port = new MessageChannel().port1; port.ref(); process.on('exit', (c) => console.log('exit-event', c));`
- `p3-ref-unref.cjs`: `const port = new MessageChannel().port1; port.ref(); port.unref(); process.on('exit', (c) => console.log('exit-event', c));`
- `p4-fresh.cjs`: `const port = new MessageChannel().port1; process.on('exit', (c) => console.log('exit-event', c, port.hasRef()));`
- `p5-waitasync-bare.cjs`: `const i32 = new Int32Array(new SharedArrayBuffer(4)); const r = Atomics.waitAsync(i32, 0, 0, 300); console.log('async', r.async); r.value.then((v) => console.log('late', v)); process.on('exit', (c) => console.log('exit-event', c));`

`p1-shape.cjs`:

```js
const wt = require('node:worker_threads');
const { port1, port2 } = new MessageChannel();
console.log(JSON.stringify({
  node: process.version,
  sameChannel: MessageChannel === wt.MessageChannel,
  samePort: MessagePort === wt.MessagePort,
  isPort: port1 instanceof MessagePort,
  ref: typeof port1.ref, unref: typeof port1.unref, hasRef: typeof port1.hasRef,
  on: typeof port1.on, addEventListener: typeof port1.addEventListener,
  protoRef: Object.prototype.hasOwnProperty.call(MessagePort.prototype, 'ref'),
  protoHasRef: Object.prototype.hasOwnProperty.call(MessagePort.prototype, 'hasRef'),
  ownKeys: Reflect.ownKeys(port1).map(String),
  fresh: port1.hasRef(),
  refRet: String(port1.ref()),
  afterRef: port1.hasRef(),
  refRet2: String(port1.ref()),
  unrefRet: String(port1.unref()),
  afterUnref: port1.hasRef(),
  peerFresh: port2.hasRef(),
}));
port1.close();
```

`p6-waitasync-ref.cjs`:

```js
const port = new MessageChannel().port1;
if (port.ref) port.ref();
const i32 = new Int32Array(new SharedArrayBuffer(4));
Atomics.waitAsync(i32, 0, 0, 300).value.then((v) => {
  console.log('late', v, port.hasRef());
  if (port.unref) port.unref();
  console.log('after-unref', port.hasRef());
});
process.on('exit', (c) => console.log('exit-event', c));
```

`p7-listeners.cjs`:

```js
const out = {};
const mk = () => new MessageChannel();
{ const {port1} = mk(); port1.addEventListener('message', () => {}); out.addEventListener = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); port1.onmessage = () => {}; out.onmessage = port1.hasRef(); port1.onmessage = null; out.onmessageNull = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); const f = () => {}; port1.on('message', f); out.on = port1.hasRef(); port1.off('message', f); out.off = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); const f = () => {}; port1.addEventListener('message', f); port1.addEventListener('message', () => {}); port1.removeEventListener('message', f); out.removeOneOfTwo = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); const f = () => {}; port1.addEventListener('message', f); port1.removeEventListener('message', f); out.removeLast = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); port1.addEventListener('messageerror', () => {}); out.messageerror = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); port1.addEventListener('close', () => {}); out.closeListener = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); port1.start(); out.startOnly = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); port1.addEventListener('message', () => {}); port1.unref(); out.listenerThenUnref = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); port1.unref(); port1.addEventListener('message', () => {}); out.unrefThenListener = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); const f = () => {}; port1.addEventListener('message', f); port1.unref(); port1.addEventListener('message', () => {}); out.secondListenerAfterUnref = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); const f = () => {}; port1.ref(); port1.addEventListener('message', f); port1.removeEventListener('message', f); out.manualRefThenListenerRemoved = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); port1.addEventListener('message', () => {}, {once: true}); out.once = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); const f = () => {}; port1.addEventListener('message', f); port1.addEventListener('message', f); port1.removeEventListener('message', f); out.dupAddOneRemove = port1.hasRef(); port1.close(); }
{ const {port1} = mk(); const ac = new AbortController(); port1.addEventListener('message', () => {}, {signal: ac.signal}); ac.abort(); out.abortSignalRemove = port1.hasRef(); port1.close(); }
console.log(process.version, JSON.stringify(out));
```

`p8-close.cjs`:

```js
const mode = process.argv[2];
const {port1: port, port2: peer} = new MessageChannel();
const ev = [];
port.ref();
port.addEventListener('close', () => { ev.push('port-close-event:' + port.hasRef()); port.ref(); ev.push('ref-in-close:' + port.hasRef()); });
peer.addEventListener('close', () => ev.push('peer-close-event'));
port.unref(); port.ref(); // listener 'close' doesn't ref; keep manual ref
(mode === 'own' ? port : peer).close();
ev.push('sync:' + port.hasRef());
queueMicrotask(() => ev.push('microtask:' + port.hasRef()));
setImmediate(() => ev.push('immediate:' + port.hasRef()));
setTimeout(() => ev.push('timeout0:' + port.hasRef()), 0);
process.on('exit', (c) => console.log(process.version, mode, JSON.stringify(ev), 'code', c));
```

`p9-close-misc.cjs`:

```js
const out = {};
{ const {port1, port2} = new MessageChannel(); port1.close(); out.closedThenRef = [String(port1.ref()), port1.hasRef()]; }
{ const {port1, port2} = new MessageChannel(); port1.ref(); port1.close(); port1.close(); out.closeTwice = port1.hasRef(); port1.unref(); out.unrefAfterClose = port1.hasRef(); }
{ const {port1, port2} = new MessageChannel(); port2.ref(); port1.close(); out.peerRefSyncAfterClose = port2.hasRef(); }
console.log(process.version, JSON.stringify(out));
```

`p10-transfer.cjs`:

```js
const mode = process.argv[2];
const {port1, port2} = new MessageChannel();
process.on('exit', (c) => console.log(process.version, mode, 'exit', c, 'src.hasRef', port1.hasRef()));
if (mode === 'clone-refd') {
  port1.ref();
  const copy = structuredClone(port1, {transfer: [port1]});
  console.log('copy.hasRef', copy.hasRef(), 'src.hasRef', port1.hasRef(), copy === port1, copy instanceof MessagePort);
  setImmediate(() => console.log('imm src.hasRef', port1.hasRef(), 'copy', copy.hasRef()));
} else if (mode === 'clone-refd-copyref') {
  port1.ref();
  const copy = structuredClone(port1, {transfer: [port1]});
  copy.ref();
  setTimeout(() => { console.log('late copy.hasRef', copy.hasRef()); }, 50);
} else if (mode === 'post-refd') {
  const {port1: a, port2: b} = new MessageChannel();
  port1.ref();
  b.onmessage = (e) => { console.log('received port', e.data instanceof MessagePort, e.data.hasRef()); b.close(); };
  a.postMessage(port1, [port1]);
  console.log('after post src.hasRef', port1.hasRef());
} else if (mode === 'peer-transferred-close') {
  port1.ref();
  const copy = structuredClone(port2, {transfer: [port2]});
  copy.close();
  setImmediate(() => console.log('imm port1.hasRef', port1.hasRef()));
}
```

`chromium-close.mjs`:

```js
import { chromium } from '@playwright/test';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async () => {
    async function probe() {
      const out = {};
      const { port1, port2 } = new MessageChannel();
      out.shape = { onclose: 'onclose' in port1, ref: typeof port1.ref, unref: typeof port1.unref, hasRef: typeof port1.hasRef, on: typeof port1.on };
      const ev = [];
      port1.addEventListener('close', () => ev.push('p1-close'));
      port2.addEventListener('close', () => ev.push('p2-close'));
      port1.start(); port2.start();
      port2.close();
      ev.push('after-close');
      await new Promise((r) => setTimeout(r, 200));
      out.events = ev;
      // transfer detach probe
      const c = new MessageChannel();
      const copy = structuredClone(c.port1, { transfer: [c.port1] });
      let postAfter = 'ok';
      try { c.port1.postMessage('x'); } catch (e) { postAfter = e.name; }
      let closeAfter = 'ok';
      try { c.port1.close(); } catch (e) { closeAfter = e.name; }
      let retransfer = 'ok';
      try { structuredClone(c.port1, { transfer: [c.port1] }); } catch (e) { retransfer = e.name + ':' + e.message; }
      out.detached = { postAfter, closeAfter, retransfer, copyIsPort: copy instanceof MessagePort };
      // postMessage return value
      out.postReturn = String(port1.postMessage === MessagePort.prototype.postMessage);
      return out;
    }
    const pageResult = await probe();
    const url = URL.createObjectURL(new Blob(['(' + probe.toString() + ')().then(postMessage)'], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const workerResult = await new Promise((resolve, reject) => { worker.onmessage = (e) => resolve(e.data); worker.onerror = (e) => reject(new Error(e.message)); });
    worker.terminate();
    return { page: pageResult, worker: workerResult, waitAsync: typeof Atomics.waitAsync };
  });
  console.log(browser.version(), JSON.stringify(result, null, 1));
} finally { await browser.close(); }
```

Descriptor and NodeEventTarget probes (`node -e`):

```js
for (const k of ['ref','unref','hasRef','close','start','postMessage']) { const d = Object.getOwnPropertyDescriptor(MessagePort.prototype, k); console.log(k, d ? JSON.stringify({w:d.writable,e:d.enumerable,c:d.configurable,type:typeof d.value, name: d.value && d.value.name, length: d.value && d.value.length}) : 'not-own'); }
try { MessagePort.prototype.ref.call({}); } catch (e) { console.log('ref-on-object', e.name, e.code, e.message); }
let p = Object.getPrototypeOf(MessagePort.prototype); while (p && p !== Object.prototype) { console.log(p.constructor.name + ': ' + Object.getOwnPropertyNames(p).filter((n) => n !== 'constructor').join(',')); p = Object.getPrototypeOf(p); }
```
