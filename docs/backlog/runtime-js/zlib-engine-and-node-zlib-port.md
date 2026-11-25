---
area: runtime-js
status: draft
title: The wasm zlib engine under a port of Node's handle and whole lib/zlib.js gives Node's sync forms, crc32 and classes on every host
created: 2026-11-24
why: Node's one-shots, sync forms and classes are all lib/zlib.js over one native handle; the sync half needs no stream machinery and is deliverable before the streams goal
epic: node-zlib-on-every-host
sources: [docs/adr/runtime-js/0573-compute-node-zlib-with-a-wasm-build-of-node-s-own-deps-zlib-on-every-host.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md, docs/backlog/runtime-js/zlib-trailing-bytes-after-stream-end.md, docs/backlog/runtime-js/zlib-crc32.md, docs/backlog/runtime-js/zlib-web-compression-subset.md, docs/backlog/runtime-js/zlib-class-call-shape.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/isolate-guest/src/guest/ceiling-zlib.ts]
---

## Context

Unit 2 of the goal, cut by Node's structure (manager 2026-11-24): in Node v24.16.0 every one-shot is
`new ctor(opts)` (`lib/zlib.js:786-799`) — sync forms run `processChunkSync` straight on the handle,
callback forms run `zlibBuffer` (`:113-129`: `on('data'|'error'|'end')` + `end(buffer)`, errors via
`destroy()`). So this unit ports `node_zlib.cc` ZlibContext as the handle and `lib/zlib.js` whole,
classes included, over ADR-0573's engine, on browser Workers and in the isolate guest (its
`ceiling-zlib.ts` members become this).

Measured on main (`results/transform-path.txt`, `lib/zlib.js` ported over a `Transform` parameter):

| what the path takes from `Transform` | Node | rifty `Transform` today | wall |
|---|---|---|---|
| `Transform.call(this, opts)` construction, legacy call shape | yes | as Node | no |
| `end(buffer)` → `_transform` with Node's last-chunk flag (`writableEnded && writableLength`) | `write(0)…write(4)` | same flag sequence | no |
| `push` / `'data'` / `'end'` / bytes / `info.engine` | — | as Node (7/7 scenarios) | no |
| error → `destroy(err)` → `'error'` → callback → `'close'` order | — | as Node | no |
| `destroy()` → `_destroy(err, cb)` → handle `close()` | always | **never runs**: handle stays open after every async one-shot and every sync error | `runtime-js/stream-destroy-construct-hooks` |
| `close()` after `maxOutputLength` stops the engine | 1 write | 2 writes (no `_destroy`) | same |
| sync success path closes the handle itself (`processChunkSync` → `_close`) | yes | as Node | no |

So the callback one-shots (and `createGzip`, which works on browser hosts today over
`CompressionStream`, ADR-0178) ride the wall; they move in unit 3. Until then they keep today's
behaviour per host — browser: the `CompressionStream` subset (compat ⚠️, ADR-0159); isolate: the named
`NotImplementedError` — because replacing a working call with a throw is a fake (AGENTS.md
§Fidelity). Open for the manager: whether the sync error path, whose handle is freed only by the
`FinalizationRegistry` while `_destroy` does not run, ships here or waits too.

Acceptance seeds (each traced at compile time):
- carrier cases green after this unit: every `*Sync` (7, incl. `unzipSync`), `info: true` on a sync
  form (`{ buffer, engine }`, `engine instanceof zlib.Deflate`), `crc32`, construction of the 7 classes
  with `new`, without `new` (DEP0184 once) and `util.inherits` + `X.call(this, opts)`, pngjs
  `PNG.sync.read` (`_processChunk` over `_handle`), pdfkit and pngjs `PNG.sync.write` (`deflateSync`);
- the engine is compiled on first use, never at module load (Chromium 108 page main thread refuses
  sync compile > 4 KB, `results/chromium108.txt`); a Chromium 108 Worker case runs a sync form;
- every engine pointer checked: a failed `malloc` is a loud error, with a test that exhausts memory;
- `zlib.wasm` rebuilt from the pinned Node tarball on the Linux CI runner by a pinned toolchain
  (release + digest) gives the committed sha256; the binary and the ported Node code are in the
  licence record (`vendor/`/`generated/` manifest, PR #445);
- before wiring: measure whether the builtin `zlib` module (engine included) can leave the client
  generic eager graph without changing `require('zlib')`'s synchronous semantics (ADR-0573 §8: 15296 B
  gzip left with the engine inline, before this port);
- matrix rows the probe lacks: error class and output produced before an error on streams,
  `bytesWritten`, `info` across forms.

Probe facts on the wasm build: 1420/1420 matrix (incl. `crc32` 32/32, `windowBits: 8`); Node's own
`test-zlib*.js` through a swapped handle 62/62 (36 deflate-family files write through the engine —
an API-shape proof; bytes are the matrix's); pdfkit and pngjs sync byte-identical.

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge); re-cut 2026-11-24 after the external review's B1.
