# Map — node-zlib-on-every-host

One chokepoint, ordered by dependency (manager 2026-11-24, after round 2 of the external review of
PR #448): Node's zlib classes are `Transform` subclasses and their observable state is `Transform`'s,
so Node's `lib/zlib.js` comes to rifty only on a `Transform` equal to Node's on every zlib path.

## Items

1. `runtime-js/zlib-node-acceptance-carrier` — **carrier** (ready) — the User scenario as 10 parity
   cases (isolate sandbox and both browser hosts vs a live `node` on the same runner), each pinning
   today's measured outcome and naming the unit that turns it green.
2. `runtime-js/zlib-engine` — **engine + handle + `crc32`** (ready) — ADR-0573's wasm build, a port of
   Node's handle proven against Node without rifty's `Transform` (binding-level matrix; Node's own
   `lib/zlib.js` over it in a Node-hosted test), `zlib.crc32` on every host. Absorbs
   `runtime-js/zlib-crc32`. Everything else in `node:zlib` stays as on main. → I1 (`crc32`), carrier 7a.
3. `runtime-js/zlib-node-lib-port` — **Node's `lib/zlib.js` whole** (draft) — classes, `*Sync`,
   callback one-shots, `create*`, `info`, `_processChunk`; today's browser `Gzip`/`CompressionStream`
   leaves in the same step; `FinalizationRegistry` as Node's `MakeWeak`, with a GC-lane proof. Entry
   criterion: `zlib-diff.mjs` shows 0 differences between Node's and rifty's `Transform` on every zlib
   path (today 10/16 scenarios, 48 fields). Absorbs `runtime-js/zlib-trailing-bytes-after-stream-end`,
   `runtime-js/zlib-class-call-shape`, the rest of `runtime-js/zlib-web-compression-subset`. → I1–I4,
   carrier 3w, 3r, 4, 5a, 5b, 7b (and 1, 2, 6 if load does not bite).
4. `runtime-js/zlib-streams-under-load` — **zlib as streams under load** (draft) — backpressure,
   destroy mid-write, event order. → I5, carrier 1, 2, 6.

## Dependencies on the streams goal (thread `t3/node-streams-goal`)

What units 3–4 need from rifty's streams, measured by `zlib-diff.mjs` on main
(`docs/backlog/runtime-js/reference/zlib-engine-probe/results/zlib-diff.txt`); the manager passes it to
that goal, and the parts are named here by that goal's item slugs once they exist on its branch:

- unit 3 ← `_destroy`/`_construct` hooks and `autoDestroy` (`runtime-js/stream-destroy-construct-hooks`);
  `closed`, `errored`, `readableFlowing`; constructor option validation (`highWaterMark`, `signal`);
  `finished` on a stream closed before writing (`ERR_STREAM_PREMATURE_CLOSE`); `write(chunk, '', cb)`
  taking the default encoding (Node's `flush()` path).
- unit 4 ← `Transform` backpressure (`runtime-js/transform-readable-backpressure`) and the
  `'finish'`/`'end'`/`'close'` order (`runtime-js/duplex-end-finish-close-order`).

## Open questions

- Whether Node's own `test/parallel/test-zlib*.js` can run inside rifty as an extra parity corpus for
  unit 3 (in real Node 36 of its 47 deflate-family files write through the engine) — owner: agent — a
  trial run of `test/common` in the isolate host during unit 3.

## Decisions

- Engine: the wasm build of Node v24.16.0's `deps/zlib` on every host — ADR-0573 accepted by the
  manager 2026-11-24 under the user's delegation («исследуй и запускай»), not the user's choice.
  Ground: the only candidate at 1420/1420 and Node's suite 62/62 without zlib algorithm code written in
  rifty (pako needs a rifty `deflateParams` port and a rifty `crc32`; the handle is a port of Node's
  `node_zlib.cc` either way); no difference observable against Node.
- Order: units 1–2 now, in a thread from `main` after this map merges; unit 3 after the streams goal's
  parts listed above; unit 4 after its backpressure part. The final interleaving with the streams goal
  is the manager's once both goals are ready.
- Until unit 3, every `node:zlib` member but `crc32` keeps its behaviour on main per host (browser:
  `CompressionStream` subset, ADR-0159/0178; isolate: `NotImplementedError`) — no intermediate state
  with two engines, no throw in place of working behaviour (AGENTS.md §Fidelity).

## Out of scope

- Brotli (`brotliCompress`/`…Sync`/`createBrotli*`/`BrotliCompress`/`BrotliDecompress`) and zstd
  (`zstdCompress`/`…Sync`/`createZstd*`/`ZstdCompress`/`ZstdDecompress`): `NotImplementedError` on
  every host, compat ❌ — manager's scoping, user confirmation pending.
- The gzip header OS byte of a macOS or Windows Node (19 / 10): rifty writes 3 (goal Decisions).
- The SDK page's own main-thread import on Chromium 108 (`runtime-js/chromium108-sdk-sync-wasm-import`).
