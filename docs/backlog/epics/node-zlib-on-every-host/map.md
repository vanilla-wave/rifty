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
   `runtime-js/zlib-web-compression-subset`. → I1, I4, I5, scenario 1–3, 6. **Blocked on rifty's
   streams**: it stands on rifty's `Transform` (no backpressure, no `_destroy`) — the same wall as the
   parked PRs #434 (`fs` ReadStream/WriteStream close) and #437 (isolate `fs.createReadStream`), whose
   streams goal waits on the user. Units 1–2 run now; unit 3 starts after that decision, or with the
   named walls as declared residuals (compat ⚠️ + backlog). Streams are not fixed inside zlib.
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

- Engine: the wasm build of Node v24.16.0's `deps/zlib` on every host — ADR-0573 accepted by the
  manager 2026-11-24 under the user's delegation («исследуй и запускай»), not the user's choice.
  Ground: the only candidate at 1418/1418 and 62/62 with no zlib code written in rifty (pako needs a
  rifty `deflateParams` port and a rifty `crc32`); no difference observable against Node.
- Order: units 1–2 now, in a thread from `main` after this map merges; unit 3 per its line above.

## Out of scope

- Brotli (`brotliCompress`/`…Sync`/`createBrotli*`/`BrotliCompress`/`BrotliDecompress`) and zstd
  (`zstdCompress`/`…Sync`/`createZstd*`/`ZstdCompress`/`ZstdDecompress`): `NotImplementedError` on
  every host, compat ❌ (manager 2026-11-24).
- The gzip header OS byte of a macOS or Windows Node (19 / 10): rifty writes 3 (goal Decisions).
- Chromium 108 main-thread sync wasm compile (`runtime-js/chromium108-sdk-sync-wasm-import`).
