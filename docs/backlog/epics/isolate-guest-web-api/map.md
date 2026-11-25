# Map — isolate-guest-web-api

Probes in `reference/` (each README holds its command, results and «not verified»):
- `today` (2026-11-25, main bc3412420): pins of today's outcomes for the three groups and the
  scenario, load-time reads;
- `textdecoder`: Node's decoders vs WHATWG, candidates;
- `sources-native`: `Blob`/`File` (and the `URL`/`structuredClone` facts now owned by
  `isolate-guest-modern-code` or out of scope);
- `sources-js`: `EventTarget`/`AbortController` (and web streams, out of scope);
- `seam-esm`: the load-order seam (its `URL`/ESM half: `isolate-guest-modern-code`);
- `enumerate`: the builtin-export identity sweep, the `catch` pass.

## Items

1. `distribution/isolate-guest-web-api-acceptance` — draft — the carrier: §User scenario's pptx and
   docx generators as `it.fails` sandbox cases against live `node`, plus the zlib carrier's case 4
   (pdfkit) reused (I5).
2. `runtime-js/isolate-guest-blob-file` — draft — `Blob`/`File` from Node's `blob.js`/`file.js` over
   a JS byte store, loaded with the runtime and installed as globals before guest code, `buffer`'s
   `Blob`/`File` exports (`buffer.ts:42-43`, the set's only load-time reads) bound to them then
   (I1, I4).
3. `distribution/isolate-guest-textdecoder-legacy-encodings` — draft — `TextDecoder`/`TextEncoder`
   from Node's `encoding.js`, the 28 single-byte encodings and `x-user-defined` from Node's
   `single-byte.js`, utf-16le/be, gbk, gb18030 from @exodus/bytes 1.16.0 — utf-8 plus the 33 of 38
   other encodings where Node equals WHATWG; carries
   `distribution/isolate-guest-textencoder-encodeinto-arg-checks` (I2, I4). The five ICU-only
   encodings are not seeded (question T).
Not seeded here: `distribution/isolate-stream-core-abort-controller` — goal `node-streams-as-in-node`
unit 7 (branch `t3/node-streams-goal`, not on main yet): Node's `abort_controller.js` +
`event_target.js` + `webidl.js` in the isolate as guest globals (its former 7g; the user's answer),
first consumer Node's `pipeline`. Its contract has no rows yet; I3's rows (WPT `dom/abort`/
`dom/events`, statics, `DOMException`, Node's `signal` APIs) join it once its home and M1 are
settled — the questions below.

Walls the carrier is expected to hit, owned elsewhere: zlib (`node-zlib-on-every-host`) after
pdfkit's font load.

## Open questions

- T. The five ICU-only `TextDecoder` encodings — owner: user (via the manager). Node decodes big5,
  euc-jp, shift_jis, euc-kr, iso-2022-jp through ICU `ucnv`, which differs from WHATWG on 8 401,
  16 681, 3 121, 19 530 and 26 sequences (silent lead-byte drops; `reference/textdecoder`):
  (a) they stay the named gap `isolate-host.TextDecoder(<enc>)` — the set is the 34 encodings where
  Node equals WHATWG (fontkit/pdfkit need only `ascii`/`latin1`/`utf-16le`/`utf-16be`);
  (b) port ICU's converters for them (a Node-output dump is 36–55 KB gzip each,
  `results-icu-dump-size.txt`; the converter state machine too; not measured); (c) WHATWG decoders
  (@exodus/bytes, measured) for them, declared ⚠️ against Node (browser results) — recommended (a).
  Asked 2026-11-25. Unit 3 does not depend on it: its set is the 34 either way.
- M1. `CustomEvent` (the same `event_target.js`, a Node 24 global, ~0 bytes extra) as a guest
  global with the four — owner: user (decided by the manager by delegation) — asked 2026-11-25;
  recommended yes (Node has it; Node's WPT `dom/events` constructs it; a ceiling beside a real base
  class saves nothing). Until answered, I3 excludes the tests that construct `CustomEvent`.
- M2. Web streams in the isolate after the split: goal `node-streams-as-in-node` points them to this
  goal, the user's narrowing left them out — owner: user (decided by the manager by delegation) —
  asked 2026-11-25. Until settled,
  `Blob.prototype.stream` and `TextDecoderStream` are named gaps.
- Home of the abort/event unit (this goal or `node-streams-as-in-node`) and where I3's rows live —
  owner: user (decided by the manager by delegation) — asked 2026-11-25.

## Out of scope

- `URL`/`URLSearchParams`, ES modules, `url.toASCII` in the isolate, the runtime's other
  load-time captures (`runtime-js/isolate-web-globals-captured-at-load`): `isolate-guest-modern-code`.
- Web streams (`Blob.prototype.stream` stays the `ReadableStream` named gap), `structuredClone`,
  `MessageChannel` (the abort/event unit stubs `internalBinding('messaging')`; transferring a signal is a named
  gap), `fetch`, `crypto.subtle`, `CompressionStream`, `URLPattern`, `Performance*`.
- `fs.createReadStream` reads: `node-streams-as-in-node` unit 9r
  (`distribution/isolate-host-fs-read-stream-needs-web-readablestream`).
- Every-host gaps found by `reference/today`: `events.addAbortListener` (`node-streams-as-in-node`
  unit 3), `util.aborted` (`runtime-js/util-aborted-missing`), `stream.addAbortSignal` argument
  check (`io/src/streams/readable.ts:1399`) and `stream/promises.pipeline` with a generator stage —
  the stream core goal's (Node's own `lib/internal/streams`).
- Browser hosts' Web globals (native there); browser-host `navigator`/browser-only globals.
