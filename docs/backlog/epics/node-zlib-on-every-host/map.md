# Map — node-zlib-on-every-host

## Items

1. `runtime-js/zlib-node-acceptance-carrier` — **carrier** — the User scenario as RED parity
   (isolate sandbox vs real `node main.js`) + Chromium e2e; first, before engine code.
2. `runtime-js/zlib-engine-one-shots` — **engine + handle + one-shots** — ADR-0573's engine under a
   port of Node's handle; one-shots, `*Sync`, `unzip`, `crc32` on every host; absorbs
   `runtime-js/zlib-trailing-bytes-after-stream-end`, `runtime-js/zlib-crc32` and the one-shot rows of
   `runtime-js/zlib-web-compression-subset` (each deleted when this lands). → I1–I3, scenario 3–5, 7.
3. `runtime-js/zlib-node-stream-classes` — **streams** — Node's classes, `create*`, members and
   internals over the same handle; absorbs `runtime-js/zlib-class-call-shape` and the rest of
   `runtime-js/zlib-web-compression-subset`. → I1, I4, I5, scenario 1–3, 6.
4. Walls the carrier exposes after 3 (hypotheses until hit): rifty `Transform` backpressure
   (`runtime-js/transform-readable-backpressure`), `_destroy` (`runtime-js/stream-destroy-construct-hooks`
   — zlib's frees the engine state), event order (`runtime-js/duplex-end-finish-close-order`).

## Open questions

- Tier: `works` is the manager's provisional default (2026-11-24) — owner: user — the manager carries
  the question and brings the answer; the goal stays `draft` until it lands.
- Which existing harness carries scenario 1–7 in Chromium on both browser hosts (Workbench and SDK) —
  owner: agent — settled by unit 1 against the e2e harnesses.
- Whether Node's own `test/parallel/test-zlib*.js` (the 47 deflate-family files pass on the engine in
  real Node, probe) can run inside rifty as an extra parity corpus — owner: agent — a trial run of
  `test/common` in the isolate host during unit 2.

## Decisions

- Engine: ADR-0573 (Proposed) recommends the wasm build of Node's `deps/zlib`; pako 3.0.3 + a
  `deflateParams` port measured the same Node-observable behaviour. Units 2–3 do not depend on the
  choice: both put the same port of Node's handle over z_stream primitives (probe `driver.mjs` ran
  both). The manager accepts or replaces ADR-0573 before unit 2 starts.

## Out of scope

- Brotli (`brotliCompress`/`…Sync`/`createBrotli*`/`BrotliCompress`/`BrotliDecompress`) and zstd
  (`zstdCompress`/`…Sync`/`createZstd*`/`ZstdCompress`/`ZstdDecompress`): `NotImplementedError` on
  every host, compat ❌ (manager 2026-11-24).
- The gzip header OS byte of a macOS or Windows Node (19 / 10): rifty writes 3 (goal Decisions).
- Chromium 108 main-thread sync wasm compile (`runtime-js/chromium108-sdk-sync-wasm-import`).
