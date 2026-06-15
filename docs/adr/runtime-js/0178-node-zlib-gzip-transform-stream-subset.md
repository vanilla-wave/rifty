# ADR 0178: node:zlib gzip Transform stream subset

Status: Accepted
Date: 2026-06

> TL;DR: Implement only `zlib.createGzip()` / `new zlib.Gzip()` as a real
> `Transform` backed by host `CompressionStream('gzip')`, because Vite preview's
> compression middleware is the forcing consumer. Other zlib stream factories
> stay loud `NotImplementedError` ceilings until each has a parity surface.

## Context

ADR-0159 delivered the async one-shot zlib subset and explicitly deferred the
Transform-stream surface. The gate has now arrived: real `vite preview` serves
built static assets through Vite/sirv's compression path, which expects
`zlib.createGzip()` to return a Node-shaped `Transform`.

The browser still has no native zlib engine and no sync compression primitive.
The only honest implementation path is the WHATWG `CompressionStream` already
used for ADR-0159. That primitive is async and streaming, and can faithfully
emit gzip wire bytes, but it does not expose Node's flush opcodes, zlib params,
or the rest of the zlib stream family.

## Decision

Implement the narrow gzip Transform subset:

- `zlib.createGzip(options?)` returns a rifty `Transform`.
- `new zlib.Gzip(options?)` is constructible and behaves like the factory.
- Each written chunk is encoded to bytes using the write encoding, fed to
  `CompressionStream('gzip')`, and emitted as `Buffer` chunks.
- `_flush` waits for pending writes, closes the web writer, and waits for the
  compressed readable side to drain before ending the Transform.
- Unsupported wire/shape options reuse ADR-0159's policy and throw
  `NotImplementedError`; size-only options remain accepted no-ops.

Do not implement or fake the rest of the stream surface in this PR:

- `createGunzip`, `createDeflate`, `createInflate`,
  `createDeflateRaw`, `createInflateRaw`, `createUnzip` stay loud.
- `Gunzip`, `Deflate`, `Inflate`, raw variants, brotli, and zstd classes stay
  loud.
- Flush-opcode parity, zlib parameter APIs, exact backpressure parity, and
  decompression-stream error-code parity remain out of scope.

## Consequences

- (+) Vite preview compression middleware and similar gzip-only HTTP middleware
  can run without a fake no-op compressor; emitted bytes are real gzip bytes
  readable by Node's native zlib.
- (+) The public surface expands only where there is a forcing consumer and
  targeted conformance tests.
- (-) This is not "zlib streams are done": decompression streams, deflate
  streams, unzip auto-detect, brotli/zstd, and sync APIs remain unavailable and
  must keep throwing loudly.
- (-) Backpressure is bridged through the existing rifty Transform contract, not
  Node's native C++ zlib engine internals; add parity before widening this
  subset.

Update `docs/public/compat/zlib.md` and
`docs/backlog/runtime-js/zlib-web-compression-subset.md` to mark only
`createGzip`/`Gzip` as implemented.
