# Map — node-zlib-on-every-host

One chokepoint, ordered by dependency (manager 2026-11-24, after round 2 of the external review of
PR #448): Node's zlib classes are `Transform` subclasses and their observable state is `Transform`'s,
so Node's `lib/zlib.js` comes to rifty only on a `Transform` equal to Node's on every zlib path.

## Items

1. `runtime-js/zlib-node-acceptance-carrier` — **carrier** (ready) — the User scenario as 10 parity
   cases (isolate sandbox and both browser hosts vs a live `node` on the same runner), each pinning
   today's measured outcome; all ten expected green after unit 3.
2. `runtime-js/zlib-engine` — **engine build + handle, no guest surface** (ready) — ADR-0573's wasm
   build from a pinned toolchain, rebuilt on Linux CI to the committed sha256, licence record; a port of
   Node's handle proven against Node without rifty's `Transform` (binding-level matrix; Node's own
   `lib/zlib.js` over it in a Node-hosted test); no bundle carries either.
3. `runtime-js/zlib-node-lib-port` — **Node's `lib/zlib.js` whole + `crc32` + the engine entering the
   bundles** (draft) — classes, `*Sync`, callback one-shots, `create*`, `info`, `_processChunk`,
   `crc32`; lazy compile with the import instrumentation test, the Chromium 108 floor run, the
   chunk/budget measurement, the exact pin of the engine's base64 in `check:esbuild-legacy-retirement`
   (ADR-0391); today's browser `Gzip`/`CompressionStream` leaves in the same step;
   `FinalizationRegistry` as Node's `MakeWeak`. Entry: `zlib-diff.mjs` state group = 0 (today 26/45
   scenarios, 154 fields). Exit: the same scenarios against product `node:zlib` in the isolate and in
   Chromium. Absorbs `runtime-js/zlib-crc32`, `runtime-js/zlib-trailing-bytes-after-stream-end`,
   `runtime-js/zlib-class-call-shape`, `runtime-js/zlib-web-compression-subset`. → I1–I5, all carrier
   cases.
4. `runtime-js/zlib-streams-under-load` — **hypothesis** (draft) — exists only if the carrier after
   unit 3 measures a wall under load; otherwise deleted.

Merge order: units 2 and 3 are adjacent merges (manager 2026-11-24), so `main` never holds the engine
without a caller for an open-ended time; the build work runs in parallel with the streams goal. Unit
2's PR, titled `[hold: merges with zlib-node-lib-port]`, is GitHub-ready only for a full CI run and the
external review, back to draft after a clean review, draft until `zlib-diff.mjs`'s state group is 0 on
`main`; the manager merges it after marking it ready again and a fresh full CI run on the current
`main`, then unit 3 follows.

## Dependencies on the streams goal (thread `t3/node-streams-goal`)

What units 3–4 need from rifty's streams, measured by `zlib-diff.mjs` on main
(`docs/backlog/runtime-js/reference/zlib-engine-probe/results/zlib-diff.txt`); the manager passes it to
that goal, and the parts are named here by that goal's item slugs once they exist on its branch:

- unit 3 ← `_destroy`/`_construct` hooks and `autoDestroy` (`runtime-js/stream-destroy-construct-hooks`);
  `closed`, `errored`, `readableFlowing`; `Symbol.asyncDispose`; constructor option validation
  (`highWaterMark`, `signal`); `finished` on a closed stream (`ERR_STREAM_PREMATURE_CLOSE`);
  `write(chunk, '', cb)` taking the default encoding (Node's `flush()`/`params()` path); `'end'` before
  `'finish'` where Node orders them so (`runtime-js/duplex-end-finish-close-order`).
- unit 4 (if kept) ← `Transform` backpressure (`runtime-js/transform-readable-backpressure`).

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
- Order: units 1–2 now, in threads from `main` after this map merges (unit 2's merge held, above); unit
  3 after the streams goal's parts listed above; unit 4 only if measured. The final interleaving with the streams goal
  is the manager's once both goals are ready.
- Until unit 3, every `node:zlib` member keeps its behaviour on main per host (browser:
  `CompressionStream` subset, ADR-0159/0178; isolate: `NotImplementedError`) — no intermediate state
  with two engines, no throw in place of working behaviour (AGENTS.md §Fidelity).

## Out of scope

- Brotli (`brotliCompress`/`…Sync`/`createBrotli*`/`BrotliCompress`/`BrotliDecompress`) and zstd
  (`zstdCompress`/`…Sync`/`createZstd*`/`ZstdCompress`/`ZstdDecompress`): `NotImplementedError` on
  every host, compat ❌ — manager's scoping, user confirmation pending.
- The gzip header OS byte of a macOS or Windows Node (19 / 10): rifty writes 3 (goal Decisions).
- The SDK page's own main-thread import on Chromium 108 (`runtime-js/chromium108-sdk-sync-wasm-import`).
