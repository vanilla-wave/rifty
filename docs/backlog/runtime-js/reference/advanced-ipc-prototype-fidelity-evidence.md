# Advanced IPC internal brand repair — 2026-09-23

Node v24.16.0 physical fork oracle and rifty direct preflight:
`node --import tsx docs/backlog/runtime-js/reference/advanced-ipc-prototype-node-oracle.mjs`.
The script changes only the sent values' prototypes and uses one physical Node
child with `serialization:'advanced'`.

```text
Node: raw SAB → Error: #<Object> could not be cloned.
Node: Set(raw SAB) → Error: #<SharedArrayBuffer> could not be cloned.
Node: Map(Buffer[1,2]) → child Buffer.isBuffer true, bytes [1,2]
Node physical fork: Uint8Array, DataView and Buffer with Object.prototype →
Error: Unserializable host object

rifty before repair: raw SAB and Set(raw SAB) accepted with shared backing;
Map(Buffer) accepted but child sees Uint8Array; changed-prototype Uint8Array
accepted; changed-prototype DataView raises an unnamed intrinsic TypeError.
```

`Object.prototype.toString` is not a safe brand: after changing each prototype
to `Object.prototype`, Node reports `[object Object]` for SAB, Map, Set,
Uint8Array, and DataView. Captured intrinsic slot getters still recognize them.

Executed RED before source changes:

```text
./node_modules/.bin/vitest run --project unit packages/runtime-js/src/internal/node-ipc-serialization.fault.test.ts
16 tests | 6 failed: raw SAB, Map, Set, typed array, ordinary DataView,
shared DataView after prototype replacement.
```

The Buffer-view sibling was added before implementation; after the fix the
suite has 17 tests. Node rejects a changed-prototype Buffer as an unserializable
host object; rifty now throws its named host-object ceiling. The repaired
standalone oracle reports loud raw/Set rejection, loud Map Buffer and view
ceilings; Node's changed-prototype raw-SAB error text is `#<Object>` while
rifty's existing raw-SAB ceiling names `SharedArrayBuffer`.

Fresh independent Final+GREEN review at 218f643a6 found top-level BigInt
admission on the same advanced serializer. Physical RED after adding `9n` to
`fork-structured-serialization.case.ts`: Node
`bigint:TypeError/ERR_INVALID_ARG_TYPE`, rifty `bigint:NO_THROW` and an extra
message. Direct fault RED: `1 failed / 17 skipped`. The shared top-level type
gate now rejects BigInt for both JSON and advanced; nested BigInt remains
structured-clone data. Physical parity and direct fault test are GREEN.
