# Map — isolate-guest-web-api

Probes in `reference/` (each README holds its command, results and «not verified»):
- `today` (2026-11-25, main bc3412420): pins of today's outcomes for the three groups and the
  scenario, load-time reads;
- `textdecoder`: Node's decoders vs WHATWG, candidates; `textdecoder/bundle`: the chosen
  composition inside the real guest bundle (size, warm call, corpus, pdfkit);
- `sources-native`: `Blob`/`File` (and the `URL`/`structuredClone` facts now owned by
  `isolate-guest-modern-code` or out of scope);
- `sources-js`: `EventTarget`/`AbortController` (and web streams, out of scope);
- `seam-esm`: the load-order seam (its `URL`/ESM half: `isolate-guest-modern-code`);
- `enumerate`: the builtin-export identity sweep, the `catch` pass.

## Items

1. `distribution/isolate-guest-web-api-acceptance` — **ready** — the carrier: pptx `write()` and docx
   `Packer.toBlob` as `it.fails` isolate-host cases against live `node`, plus the zlib carrier's
   case 4 (pdfkit) reused (I5).
2. `runtime-js/isolate-guest-blob-file` — **ready** — `Blob`/`File` from Node's `blob.js`/`file.js`
   over a JS byte store, loaded with the runtime and installed as globals before guest code,
   `buffer`'s `Blob`/`File` exports (`buffer.ts:42-43`) bound to them then (I1, I4, I5).
3. `distribution/isolate-guest-textdecoder-legacy-encodings` — **ready** — `TextDecoder`/`TextEncoder`
   from Node's `encoding.js` + `single-byte.js`, utf-16le/be, gbk, gb18030 from @exodus/bytes 1.16.0:
   utf-8 + the 33 Node=WHATWG encodings; the five ICU-only a named gap
   (`distribution/isolate-guest-textdecoder-icu-only-encodings`); closes
   `distribution/isolate-guest-textencoder-encodeinto-arg-checks` (I2, I4, I5).

Delivered elsewhere: `distribution/isolate-stream-core-abort-controller` — goal
`node-streams-as-in-node` unit 7 (`docs/backlog/epics/node-streams-as-in-node/map.md`, on main since
PR #450; manager decision 2026-11-25): Node's `abort_controller.js` + `event_target.js` + `webidl.js` in the isolate as guest
globals (`AbortController`, `AbortSignal`, `EventTarget`, `Event`, `CustomEvent`); its acceptance
includes this goal's I3 (`docs/backlog/distribution/isolate-stream-core-abort-controller.md`) through
the shared WPT harness of unit 2 — so unit 7's WPT rows, like unit 3's, wait for that harness. **This goal closes when units 1–3 and that unit have landed, its merged contract carrying
I3's rows and `CustomEvent`, green.**

Order: 1 first (RED). Unit 2 builds the shared WPT harness (its Acceptance 10); unit 3 is built in
parallel but merges after unit 2 — one of its 13 rows (Acceptance 4, WPT `encoding`) runs on that
harness, the rest do not (edge 3 ← 2 at merge; the same edge for `node-streams-as-in-node` unit 7); the carrier's docx case turns green with 2,
pptx with 2 (if nothing else stops it), pdfkit's isolate stop moves with 3.

Walls the carrier is expected to hit, owned elsewhere: zlib (`node-zlib-on-every-host`) after
pdfkit's font load.

## Open questions

- The `TextDecoder` composition's remaining +0.5–0.6 ms warm Δ with no non-utf-8 decoder (the load
  of `encoding.js`/`util.js` and the shims) — owner: agent — within the base's noise; unit 3
  records it (Acceptance 9).

## Closed (manager, 2026-11-25; goal Decisions)

- `Blob`/`File`'s own cost — measured in unit 2 (PR #458, ADR-0578 §Cost): `guest.js` +41 651 B
  (`gzip -9` +10 432), warm `runCode('1')` +0.3–0.7 ms.

- T — the five ICU-only encodings stay a named gap; draft
  `distribution/isolate-guest-textdecoder-icu-only-encodings` (a consumer exists, the gap is silent
  there — PR #443 review S3).
- The +2.2 ms of the eager composition — `single-byte.js` at load; lazy by unit 3's anchored edit.
- WPT harness — one, owned by unit 2 (`reference/wpt`).
- M1 — `CustomEvent` is a global with the four.
- M2 — web streams in the isolate stay outside both goals; draft
  `distribution/isolate-guest-web-streams`.
- The events/abort unit lives in `node-streams-as-in-node`.

## Out of scope

- `URL`/`URLSearchParams`, ES modules, `url.toASCII` in the isolate, the runtime's other
  load-time captures (`runtime-js/isolate-web-globals-captured-at-load`): `isolate-guest-modern-code`.
- Web streams (`Blob.prototype.stream`, `TextDecoderStream` stay named gaps;
  `distribution/isolate-guest-web-streams`), `structuredClone`, `MessageChannel` (the abort/event
  unit stubs `internalBinding('messaging')`; transferring a signal is a named gap), `fetch`,
  `crypto.subtle`, `CompressionStream`, `URLPattern`, `Performance*`.
- Ceiling module exports that are a silent `undefined` or throw under another name
  (`require('crypto').subtle`, `stream/web.*`): `distribution/isolate-guest-ceiling-module-exports-silent`.
- `fs.createReadStream` reads: `node-streams-as-in-node` unit 9r
  (`distribution/isolate-host-fs-read-stream-needs-web-readablestream`).
- Every-host gaps found by `reference/today`: `events.addAbortListener` (`node-streams-as-in-node`
  unit 3), `util.aborted` (`runtime-js/util-aborted-missing`), `stream.addAbortSignal` argument
  check (`io/src/streams/readable.ts:1399`) and `stream/promises.pipeline` with a generator stage —
  the stream core goal's (Node's own `lib/internal/streams`).
- Browser hosts' Web globals (native there); browser-host `navigator`/browser-only globals.
