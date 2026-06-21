# Compatibility matrix — Buffer (`@riftydev/io`)

Hand-maintained until `pnpm compat:generate` learns to source `@riftydev/io` tests.

Status of the Node-compatible `Buffer` polyfill that lives in `@riftydev/io` and
is re-exported by `@riftydev/runtime-js/builtins/buffer`.

Legend: ✅ implemented and tested · ⚠️ partial / known caveat · ❌ not
implemented (throws `NotImplementedError` or `TypeError`).

| Feature | Status | Notes |
|---|---|---|
| `Buffer.from(string, encoding?)` | ✅ | utf8 default; honors hex/base64/base64url/ascii/latin1/utf16le |
| `Buffer.from(Uint8Array | ArrayBuffer | array)` | ✅ | |
| `Buffer.alloc(size, fill?, encoding?)` | ✅ | Tiles encoded fill bytes; honors `encoding` for string fill |
| `Buffer.allocUnsafe(size)` | ✅ | Alias of `Buffer.alloc` semantics (no init guarantee deferred) |
| `Buffer.concat(list, totalLength?)` | ✅ | |
| `Buffer.byteLength(string, encoding?)` | ✅ | |
| `Buffer.isBuffer(v)` | ✅ | Symbol-tag based |
| `Buffer.compare(a, b)` (static) | ✅ | |
| `buf.toString(encoding?, start?, end?)` | ✅ | utf8/utf16le/ascii/latin1/hex/base64/base64url |
| `buf.slice(start?, end?)` | ✅ | Returns a Buffer-tagged subarray |
| `buf.equals(other)` | ✅ | |
| `buf.write(s, offset?, length?, encoding?)` | ✅ | Honors `length` truncation and `encoding`; flexible overloads |
| `buf.compare(other, ...)` (instance) | ✅ | |
| `buf.copy(target, targetStart?, sourceStart?, sourceEnd?)` | ✅ | |
| `buf.fill(value, offset?, end?, encoding?)` | ✅ | Tile-fills strings; honors encoding |
| `buf.indexOf(value, byteOffset?, encoding?)` | ✅ | Int byte / string / sub-Uint8Array |
| `buf.lastIndexOf(value, byteOffset?, encoding?)` | ✅ | |
| `buf.includes(value, byteOffset?, encoding?)` | ✅ | |
| `buf.readUInt8/16/32/Int8/16/32 {BE,LE}` | ✅ | Via `DataView` |
| `buf.writeUInt8/16/32/Int8/16/32 {BE,LE}` | ✅ | Returns post-write offset (Node parity) |
| `buf.read{U}IntLE/BE(offset, byteLength)` | ✅ | Variable-width 1–6 byte (≤48-bit); signed forms sign-extend |
| `buf.write{U}IntLE/BE(value, offset, byteLength)` | ✅ | 1–6 byte; returns offset+byteLength |
| `buf.readBig{U}Int64{BE,LE}` | ✅ | |
| `buf.writeBig{U}Int64{BE,LE}` | ✅ | |
| `buf.toJSON()` | ✅ | `{ type: 'Buffer', data: [...] }` round-trip |
| `Buffer.copyBytesFrom(view, offset?, length?)` | ✅ | Explicit byte-window copy (elements) of a TypedArray |
| `buf.readFloat{BE,LE}` / `buf.writeFloat{BE,LE}` | ✅ | |
| `buf.readDouble{BE,LE}` / `buf.writeDouble{BE,LE}` | ✅ | |
| `buf.swap16/32/64` | ✅ | |
| `buf.subarray(start?, end?)` | ✅ | Returns a `Buffer` via `Symbol.species` (ADR-0030) |
| `buf.copyWithin(...)` | ✅ | Inherited from `Uint8Array`; operates on the Buffer in place |
| `Buffer.poolSize`, `Buffer.constants` | ❌ | Pending — no real consumer hit yet |
| `Buffer.transcode(buffer, fromEnc, toEnc)` | ❌ | Pending |
| `kStringMaxLength` / `kMaxLength` | ❌ | Pending |
| `node:buffer` `Blob` / `File` / `atob` / `btoa` | ✅ | Browser-native re-exports |
| `node:buffer` `SlowBuffer(size)` | ✅ | = `allocUnsafeSlow` (no pool) |
| `node:buffer` `isUtf8` / `isAscii` | ✅ | Byte-scan / fatal-decode predicates |
| `node:buffer` `INSPECT_MAX_BYTES` | ✅ | Live getter/setter; drives `util.inspect(buf)` `<Buffer …>` truncation (default 50) |
| `node:buffer` `resolveObjectURL(id)` | ❌ | `NotImplementedError` — no introspectable cross-realm blob registry |

## Encoding support

| Encoding | encode | decode |
|---|---|---|
| `utf8` / `utf-8` | ✅ | ✅ |
| `utf16le` / `utf-16le` / `ucs2` / `ucs-2` | ✅ | ✅ |
| `ascii` | ✅ | ✅ |
| `latin1` / `binary` | ✅ | ✅ |
| `hex` | ✅ | ✅ |
| `base64` | ✅ | ✅ |
| `base64url` | ✅ | ✅ |

## Tests

- Unit tests live in `packages/io/src/buffer.test.ts` (33 cases).
- Parity tests:
  - `tools/node-parity-runner/cases/buffer/write-encodings.case.ts`
  - `tools/node-parity-runner/cases/buffer/alloc-fill-encoding.case.ts`
  - `tools/node-parity-runner/cases/buffer/from-and-encodings.case.ts`
  - `tools/node-parity-runner/cases/buffer/readwrite.case.ts`
  - `tools/node-parity-runner/cases/buffer/concat-equals.case.ts`
  - `tools/node-parity-runner/cases/buffer/extends-uint8array.case.ts`

## Known limitations

- `Buffer.allocUnsafe` zero-initialises (we go through `new Buffer(size)` →
  `new Uint8Array(size)`); Node leaves memory uninitialised for speed. No
  semantic difference for code that reads back what it wrote.
