# ADR 0366: Binary request frames for hot fs sync-RPC

Status: Accepted
Date: 2026-08

> TL;DR: SyncRpc v5 adds an explicit `callBinary(method, bytes)` transport;
> one dispatcher registration owns JSON and binary decoding, while runtime-js
> supplies compact codecs for the five hot read/probe fs methods.

## Context

ADR-0084 made replies binary-capable but deliberately kept every request as
`JSON.stringify({method,payload})` → UTF-8. The exact product-shaped spike
measured that framing at 3.1 µs of an ~18 µs owner round-trip. ADR-0365 removed
the extra sizing hop; the five hot calls (`exists`, `stat`, `statOrNull`,
`readFileHead`, `readChunk`) still serialize their method and payload through
JSON on every Vite resolver probe/read.

Three interfaces were considered:

- Stable numeric opcodes minimize bytes, but introduce a global ID allocation
  registry and collision authority that the outcome does not need.
- An optional third `call(method, logicalPayload, binaryPayload)` argument
  preserves the old function shape, but carries two semantic payloads. Tests
  can validate the logical value while production consumes different bytes;
  that is a shallow, self-attesting seam.
- Letting runtime-js write a complete SAB frame avoids a kernel method, but
  leaks version/discriminator/method framing and ring lifecycle into every
  application codec.

The existing `KernelSyncApi` object was explicitly designed to grow. Adding
one transport verb there keeps SAB lifecycle/framing inside one deep kernel
module and gives production plus test adapters the same interface.

## Decision

### Kernel transport

`KernelSyncApi` has two required operations:

```ts
call(method: string, payload: unknown): unknown
callBinary(method: string, payload: Uint8Array): unknown
```

The worker bootstrap publishes both through typed non-enumerable globals.
Neither present means “not a kernel worker”; exactly one present is an invalid
partial bootstrap and throws loudly. `SyncRpcClient.callBinary` owns the same
claim/wait/reply/error lifecycle as `call`; callers never see SAB framing.

SyncRpc v5 binary request bytes are:

```
offset  size       encoding
0       1          FRAME_BINARY (0x01)
1       2          method UTF-8 byte length, uint16 little-endian
3       M          method UTF-8 bytes (M in 1..65535)
3+M     remaining  application payload bytes
```

JSON requests remain `FRAME_JSON` and byte-for-byte compatible inside v5.
Binary decode validates/truncation-checks the complete envelope, uses fatal
UTF-8, and copies application bytes out of the SAB before returning. Protocol
version bumps 4→5; a v4 peer rejects before decode.

`SyncRpcDispatcher.register` accepts one optional binary payload decoder beside
the existing handler. JSON requests call the handler with their JSON payload;
binary requests synchronously decode once, then call that SAME handler. A
binary request for a method without a decoder fails with
`ERPCBINARYUNSUPPORTED` before the handler. Decoder throws use the ordinary
JSON error reply. There is no second handler registry or opcode authority.

### Runtime fs codec

`SyncRpcFsSync` requires both operations from the `KernelSyncApi` adapter as
two constructor arguments (`call`, `callBinary`). Omitting the binary operation
throws at construction; there is no legacy-function overload or JSON fallback.
The five hot methods always use `callBinary`:

- `exists`, `stat`, `statOrNull`, `readFileHead`: payload = path UTF-8 bytes.
- `readChunk`: 8-byte float64 LE offset + 8-byte float64 LE length + path UTF-8.

The shared runtime codec validates fatal UTF-8 plus non-negative safe-integer
offset/length (length ≤ `FS_RPC_CHUNK`) before the owner handler. The handler
registration supplies those decoders next to the existing semantic bodies.
`readdir` and every mutation remain JSON in this decision. Replies and JSON
error frames are unchanged.

## Consequences

- Hot owner fs requests perform no JSON stringify/parse or JSON UTF-8 body
  decode; method/ring lifecycle remains kernel-owned.
- One `KernelSyncApi` interface serves product children, recursive children,
  dev-server children, and the TypeScript worker; test adapters implement the
  same two operations.
- The binary envelope still UTF-8 encodes/decodes a method and path. This is
  deliberate: it removes the measured JSON work without an opcode registry.
- Binary application payloads make one SAB→private copy before dispatch. This
  prevents async handler retention of an aliased ring view; removing it would
  require a different lifecycle contract and evidence.
- Structured stat/boolean replies, binary readdir/writes, base64 write cost,
  large-file O(N²), and the unexplained remainder stay outside this decision.
