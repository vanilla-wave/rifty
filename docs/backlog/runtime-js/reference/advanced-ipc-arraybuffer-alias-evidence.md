# Advanced IPC ArrayBuffer/view alias — 2026-09-23

Node v24.16.0, physical fork and rifty physical Worker, same parent/child
program: `node --import tsx
docs/backlog/runtime-js/reference/advanced-ipc-arraybuffer-alias-oracle.mjs`.
The parent sends `{backing:ArrayBuffer(8), view:Uint8Array(backing,2,3)}`.
The child writes `99` through `backing[2]`, then reads `view[0]`.

```text
Node  {"before":2,"after":2,"same":false,"offset":36,"backingLength":41}
rifty before fix {"before":2,"after":99,"same":true,"offset":2,"backingLength":8}
```

Node `v8.deserialize(v8.serialize(...))` confirms the explicit backing/view
alias is broken for both property orders, Map entries, and array positions.
Two views sharing one backing retain their alias in the measured graph. A
standalone `Uint8Array([1,2])` keeps its type/bytes but Node's observable
backing layout is different (`byteOffset:5`, `buffer.byteLength:7` versus
native structured clone's `0`/`2`). That wire layout is not claimed for the
Vitest path; the explicit alias changes data and cannot be admitted silently.

Executed fault RED before source repair:

```text
./node_modules/.bin/vitest run --project unit packages/runtime-js/src/internal/node-ipc-serialization.fault.test.ts -t 'explicit ArrayBuffer/view aliases'
1 failed / 18 skipped: accepted an explicit backing/view alias.
```

The native Vitest 4.1.11/Vite 8.0.16 default-forks IPC census at
`/private/tmp/rifty-vitest-ipc-census-uxnr21cp/` observed 144 messages across
6 failing/fixed × default/verbose/npm-test runs: typed arrays, aliases,
Buffers, Maps and Sets all zero; 24 cycle edges. This does not establish a
claim for threads, custom reporters/tests or other versions.

After repair, the same physical oracle prints rifty
`{"error":"NotImplementedError","feature":"child_process.serialization.advanced.arraybuffer-view-alias"}`
before posting. Standalone Uint8Array still passes the existing physical fork
parity by type and bytes.
