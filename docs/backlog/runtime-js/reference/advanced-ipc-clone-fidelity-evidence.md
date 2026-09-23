# Advanced IPC clone-fidelity repair — 2026-09-23

Baseline: goal branch `7d675ee60`, Node v24.16.0. Probes used the existing
physical `child-worker` parity harness (`runInNode` / `runInRifty`, one typed
bootstrap Worker), `fork('child.js', [], { serialization: 'advanced', stdio:
['ignore','ignore','ignore','ipc'] })`, and a child `process.on('message')`
handler that reports the received value before disconnect/exit.

## SAB-backed views

Parent sends `new Uint8Array(new SharedArrayBuffer(3))` filled with `[1,2,3]`
and `new DataView(new SharedArrayBuffer(2))` filled with `[4,5]`. Child reports
`Object.prototype.toString` of each view and its buffer, `buffer instanceof
SharedArrayBuffer`, and exact bytes:

```text
node:  [{"label":"typed","type":"[object Uint8Array]","bufferType":"[object ArrayBuffer]","shared":false,"bytes":[1,2,3]},{"label":"view","type":"[object DataView]","bufferType":"[object ArrayBuffer]","shared":false,"bytes":[4,5]}]
rifty: [{"label":"typed","type":"[object Uint8Array]","bufferType":"[object SharedArrayBuffer]","shared":true,"bytes":[1,2,3]},{"label":"view","type":"[object DataView]","bufferType":"[object SharedArrayBuffer]","shared":true,"bytes":[4,5]}]
```

Extra Node v24 probe: three views of one SAB(8) (`Uint8Array` offset 2,
`DataView` offset 4, `Uint16Array` offset 2) arrive on separate non-shared
ArrayBuffers, with `(bufferLength, byteOffset)` respectively `(42,20)`,
`(42,27)`, `(8192,0)` and `sameBuffer:false`. A direct ArrayBuffer copy would
still differ. Direct raw SAB send throws `Error: #<SharedArrayBuffer> could not
be cloned.` in Node and rifty.

Reproducible standalone oracle:

```text
node docs/backlog/runtime-js/reference/advanced-ipc-clone-node-oracle.cjs
v24.16.0 {"views":{"values":[{"type":"[object Uint8Array]","bufferType":"[object ArrayBuffer]","shared":false,"bufferLength":55,"offset":33,"length":3,"bytes":[2,3,4]},{"type":"[object DataView]","bufferType":"[object ArrayBuffer]","shared":false,"bufferLength":55,"offset":40,"length":2,"bytes":[4,5]},{"type":"[object Uint16Array]","bufferType":"[object ArrayBuffer]","shared":false,"bufferLength":55,"offset":46,"length":4,"bytes":[2,3,4,5]}],"sameBuffer":true},"map":{"buffer":true,"type":"Buffer","bytes":[1,2]},"set":{"value":7}}
```

The backing layout differs between the two Node probe shapes, although bytes
and non-shared ownership agree. The script is the source for the second output.

## Map/Set internal entries

Parent payload: `new Map([['k', Buffer.from([1,2])]])` with own
`[Symbol.iterator] = function*(){}`. Child reports Buffer brand/type/bytes:

```text
node:  {"buffer":true,"type":"Buffer","bytes":[1,2]}
rifty: {"buffer":false,"type":"Uint8Array","bytes":[1,2]}
```

With an own iterator that throws `Error('iterator called')`, physical Node
still reads Map/Set internal entries (value `7`); direct rifty
`serializeNodeIpcMessage({map}, 'advanced')` / `{set}` throws that user error.
With an empty own Map iterator hiding raw SAB, direct rifty serialization
accepted the cloned SAB; physical Node `child.send({map})` synchronously
throws `Error: #<SharedArrayBuffer> could not be cloned.`

## Executed RED

```text
./node_modules/.bin/vitest run --project unit packages/runtime-js/src/internal/node-ipc-serialization.fault.test.ts
10 tests | 5 failed: SAB-backed Uint8Array/DataView accepted; own buffer spoof
accepted; Map/Set hostile iterators called; own empty iterator hid Buffer/SAB.
```

Faults are `provenance-lie` (shared backing/Buffer brand), `sibling-drift`
(Map and Set), and `observable-order` (user iterator invoked before the native
clone). The physical MessagePort still delivers ordered, exactly-once frames
while alive; no loss/replay/reorder model applies to this data classification.
