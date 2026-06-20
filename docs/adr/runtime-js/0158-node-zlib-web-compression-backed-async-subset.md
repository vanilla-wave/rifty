# ADR 0158: node:zlib web-compression-backed async subset

Status: Accepted
Date: 2026-06

> TL;DR: `node:zlib` async one-shot `gzip`/`gunzip`/`deflate`/`inflate`/`deflateRaw`/`inflateRaw` are
> backed by the host `CompressionStream`/`DecompressionStream` (RFC-1950/1951/1952 wire-compatible with
> real Node's zlib, both directions). Sync variants, brotli, zstd, and the Transform-stream surface stay
> loud `NotImplementedError` ceilings; wire/shape-affecting options (`windowBits`/`dictionary`/`info`)
> throw, `maxOutputLength` is honored (early-abort `ERR_BUFFER_TOO_LARGE`), size-only knobs
> (`level`/`memLevel`/`strategy`/…) are accepted no-ops.

## Context

`node:zlib` was a loud stub — every member threw `NotImplementedError` (`null-net-stubs.ts`). Ordinary
npm packages touch `gzip`/`gunzip` for registry, asset, and HTTP flows; the Consumer-Ready roadmap
names zlib a runtime wall (`backlog: runtime-js/zlib-web-compression-subset`). The browser realm has no
native zlib, but Chromium + Node 18+ expose the WHATWG `CompressionStream`/`DecompressionStream`
(`'gzip'` / `'deflate'` / `'deflate-raw'`) — already used in `npm-client/unpacker.ts` to gunzip tarballs.

Key fact (verified, conformance-pinned): `CompressionStream('gzip')` emits RFC-1952, `('deflate')` emits
RFC-1950 zlib-wrapped, `('deflate-raw')` emits RFC-1951 raw — byte-compatible with Node's
`zlib.gzip`/`deflate`/`deflateRaw`. Both directions round-trip (rifty-compressed reads in real Node;
Node-compressed reads in rifty). So the wire contract is REAL, not approximated.

The web API is async-only and exposes no compression-level / dictionary / windowBits control.

## Decision

**Implemented (real, web-backed)** — `packages/runtime-js/src/builtins/zlib.ts`:

1. Async one-shot: `gzip`/`gunzip` (`'gzip'`), `deflate`/`inflate` (`'deflate'`),
   `deflateRaw`/`inflateRaw` (`'deflate-raw'`). Node `(buf[, opts], cb)` shape, `cb(err, Buffer)`
   convention → `util.promisify` works (Node sets no `promisify.custom` here — standard convention).
   Input accepts string (utf-8), Buffer, TypedArray, DataView, ArrayBuffer.
2. `constants` = the full real Node table (170 keys incl. Z_*/BROTLI_*/ZSTD_*, pure data) + `codes`;
   the legacy top-level `zlib.Z_*` aliases too (Node shape). Surface-pinned by parity.

**Options policy** (the design judgment this ADR records):
- Size/perf knobs — `level`, `memLevel`, `strategy`, `chunkSize`, `flush`, `finishFlush` — accepted and
  ignored. Output stays VALID and round-trips; Node guarantees no specific bytes for a given level
  across versions either, so this is a ratio/perf gap, not a correctness lie.
- Wire/shape-affecting — `windowBits` (selects raw/gzip framing), `dictionary` (preset dict changes the
  wire bytes), `info` (changes return shape to `{buffer,engine}`) — throw
  `NotImplementedError('zlib.<fn> option: <name>')`. Silently ignoring these WOULD lie about the wire
  format / contract.
- `maxOutputLength` — HONORED, not ignored: the output reader aborts EARLY (cancels the stream) and
  throws `RangeError [ERR_BUFFER_TOO_LARGE]` the moment the running total exceeds it — matching Node
  observably AND as a real decompression-bomb guard (not a post-hoc length check). This is the one
  behavior-affecting option that is genuinely implementable web-side, so it is implemented, not faked.

**Loud ceilings** (`NotImplementedError`, compat ❌ — Fidelity, refines ADR-0010/0153):
- `*Sync` (`gzipSync`/`gunzipSync`/…) — `CompressionStream` is async-only; a synchronous facade over it
  would pretend async is sync. No honest sync path exists in-browser.
- Brotli (`brotliCompress`/`brotliDecompress`/`brotliCompressSync`/… + `createBrotli*` + `BrotliCompress`/
  `BrotliDecompress`) — no Web API for brotli in the realm.
- Zstd (`zstdCompress`/`zstdDecompress`/`zstdCompressSync`/`zstdDecompressSync` + `createZstdCompress`/
  `createZstdDecompress` + `ZstdCompress`/`ZstdDecompress`) + `crc32` — no Web API for zstd; `crc32` is
  out of the compression subset (both Node-24 surface, both throw).
- Transform streams (`createGzip`/`createGunzip`/`createDeflate`/`createInflate`/`createDeflateRaw`/
  `createInflateRaw`/`createUnzip` + `Gzip`/`Deflate`/… classes) — bridging `CompressionStream` to a
  Node `Transform` (flush opcodes, backpressure, chunk-boundary + error-code parity) is a broad,
  IRREVERSIBLE contract; deferred to its own ADR. Tracked in
  `docs/backlog/runtime-js/zlib-web-compression-subset.md`.
- `unzip`/`unzipSync` (auto-detect gzip vs zlib) — header-sniff has its own parity surface; deferred to
  the same backlog item.

**Error divergence (honest, documented ⚠️):** decompressing corrupt input rejects the callback with an
`Error` (error-first handling works), but its `code`/`errno` are the browser stream's, not Node's
`Z_DATA_ERROR`/`errno`. Exact zlib error codes are out of parity reach (no zlib engine in-realm).

## Consequences

- (+) Real packages that `gzip`/`gunzip` (and `util.promisify` them) for registry/asset/HTTP flows run;
  output is genuine, wire-interoperable with Node (bidirectional conformance test, not a self-roundtrip).
- (+) Every gap stays loud and located precisely: sync/brotli/streams/unzip throw with a directed
  feature string; unsupported wire options throw; only the inert ratio knobs are no-ops.
- (−) Compression ignores `level`/`strategy` — byte size and exact bytes differ from Node (correctness
  unaffected; documented in `docs/public/compat/zlib.md`).
- (−) Decompression error codes diverge from Node's `Z_*` — error-first shape holds, code/errno do not.
- (−) Streams + sync + brotli + unzip remain unavailable; their absence is loud, and the stream contract
  is gated behind a future ADR rather than shipped half-honest.

Additive method bodies are REVERSIBLE (backlog reversibility note); this ADR records the strategic subset
boundary + options policy so the ignored level-knob is not later "fixed" as a bug and no fake sync/stream
path is added without superseding here. Refines (does not overturn) the Fidelity loud-throw stance
(ADR-0010, ADR-0153).
