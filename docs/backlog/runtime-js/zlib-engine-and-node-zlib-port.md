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

Decisions (manager 2026-11-24):
- The callback one-shots and `createGzip` stay as on main per host — browser: the `CompressionStream`
  subset (ADR-0159/0178, ⚠️); isolate: the named `NotImplementedError` — because replacing a working
  call with a throw is a fake (AGENTS.md §Fidelity). They move in unit 3, or as a small add-on once the
  streams goal's first part (`_destroy`/`_construct` hooks) lands (map).
- The sync error path ships here. Its handle — and every async one-shot's once they move — is freed by
  the `FinalizationRegistry` of ADR-0573 §6 while `_destroy` does not run; `lib/zlib.js` is not
  patched for it (no own `_close` in a `catch`).

Declared residuals of this unit (compat `zlib.md` rows land with it):
- a handle after a sync error is freed at garbage collection, not at the error — until the streams
  goal's first part (thread `t3/node-streams-goal`); lifted then by a check that the handle closes in
  `_destroy`;
- on a browser host, sync forms (engine, Node's bytes) and callback forms (`CompressionStream`) of the
  same call differ (`results/async-vs-sync.txt`, Chromium 148, 45 compress + 5 decode cases):
  compressed bytes identical in 14/45, identical but the gzip OS byte in 5 more (Chromium on macOS
  writes 19; the engine 3), different in 26/45 (`level` 1 and 9 are ignored by `CompressionStream`); the
  callback form's output always decodes on the engine (45/45). Decoding a 2-member gzip, gzip + 8 zero
  bytes, zlib + LF, zlib + `JUNK!`: the sync form gives Node's result, the callback form rejects
  `TypeError: Junk found after end of compressed data.` after the first member's bytes (4/4); a
  truncated stream: sync `Z_BUF_ERROR` `unexpected end of file`, callback `TypeError: Compressed input
  was truncated.`

Acceptance seeds (each traced at compile time):
- carrier cases green after this unit: every `*Sync` (7, incl. `unzipSync`), `info: true` on a sync
  form (`{ buffer, engine }`, `engine instanceof zlib.Deflate`), `crc32`, construction of the 7 classes
  with `new`, without `new` (DEP0184 once) and `util.inherits` + `X.call(this, opts)`, pngjs
  `PNG.sync.read` (`_processChunk` over `_handle`), pdfkit and pngjs `PNG.sync.write` (`deflateSync`);
- the engine is compiled on first use, never when the builtins load: a floor-lane case on Chromium 108
  imports the builtins on the page main thread and fails if `zlib` compiles or instantiates wasm there
  (the page refuses both > 4 KB, `results/chromium108.txt` — how the lexer's `initSync` broke 108), and
  a Chromium 108 Worker case runs a sync form;
- the `FinalizationRegistry` (ADR-0573 §6) with a GC-lane test (`--expose-gc`): a handle left open
  after a sync error, and streams dropped without `close`, are freed and the allocator reuses their
  blocks;
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
