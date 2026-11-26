---
area: distribution
status: ready
title: The isolate guest's `TextDecoder` and `TextEncoder` are Node v24.16.0's for utf-8 and the 33 encodings where Node equals WHATWG, so fontkit/pdfkit load as in Node
created: 2026-11-25
why: the guest's `TextDecoder` accepts 3 of the 228 WHATWG labels (utf-8 only), so pdfkit 0.17.2 dies at load on fontkit's `new TextDecoder('ascii')`, and an unknown label throws `NotImplementedError` where Node throws `RangeError [ERR_ENCODING_NOT_SUPPORTED]`
user_story: As an agent running model-written code in the isolate host, I want `require('pdfkit')` to load as in Node, but today fontkit's module top level throws `NotImplementedError: Not implemented: isolate-host.TextDecoder(ascii) (only utf-8)`
epic: isolate-guest-web-api
sources: [docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/README.md, docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/bundle/README.md, docs/backlog/epics/isolate-guest-web-api/reference/today/README.md, packages/isolate-host/tests/zlib-scenario.test.ts]
code: [packages/isolate-guest/src/guest/text-codec.ts, packages/isolate-guest/src/guest/web-shim.ts]
---

## Context

Host: the isolate guest only (`runCode`, sandbox `exec`); browser hosts keep their native classes.
Found by the node:zlib goal's case 4 (pdfkit 0.17.2, `zlib-scenario.test.ts`): it fails in the
isolate at `fontkit/dist/main.cjs:5424` (loaded by `pdfkit/js/pdfkit.js:7`); both browser hosts get
past it and stop at `zlib.deflateSync`. Goal `isolate-guest-web-api` map unit 3. What fontkit asks
(`bundle/results-fonts.txt`): Helvetica (AFM) only `ascii`; a TTF `ascii`, `utf-16be`,
`x-mac-roman`; CJK `name` records shift_jis, big5, euc-kr, gbk.

How Node v24.16.0 decodes (`reference/textdecoder`): `lib/internal/encoding.js` maps all 228 WHATWG
labels (`replacement`'s 6 throw `ERR_ENCODING_NOT_SUPPORTED`; `ascii`/`latin1`/`iso-8859-1` →
`windows-1252`); utf-8 in C++; the 28 single-byte encodings and `x-user-defined` in JS
(`lib/internal/encoding/single-byte.js`, WHATWG tables); utf-16le/be, gbk (gb18030's decoder),
gb18030, big5, euc-jp, iso-2022-jp, shift_jis, euc-kr through ICU `ucnv`. On the 1-/2-byte corpus
Node equals WHATWG except big5, euc-jp, shift_jis, euc-kr, iso-2022-jp — those five stay a
named gap (manager decision 2026-11-25, `distribution/isolate-guest-textdecoder-icu-only-encodings`).

Today — pins (`reference/today/results.txt`, main bc3412420 product code; `exec` and `runCode`
equal):

| call | Node v24.16.0 | isolate guest |
|---|---|---|
| labels accepted | 222 / 228 | 3 / 228 (`utf-8`, `utf8`, `unicode-1-1-utf-8`) |
| `new TextDecoder('unicode11utf8'\|'unicode20utf8'\|'x-unicode20utf8').encoding` | `utf-8` | `NotImplementedError: … isolate-host.TextDecoder(<label>) (only utf-8)` |
| each other label (`ascii`, `latin1`, `cp1252`, `koi8-r`, `gbk`, `utf-16le`, `x-user-defined`, …) | its WHATWG `encoding` | the same `NotImplementedError` |
| a `replacement` label (the probe used its first, `csiso2022kr`) | `RangeError [ERR_ENCODING_NOT_SUPPORTED]: The "replacement" encoding is not supported` | `NotImplementedError … TextDecoder(<label>) (only utf-8)` |
| `new TextDecoder('nope')` | `RangeError [ERR_ENCODING_NOT_SUPPORTED]: The "nope" encoding is not supported` | `NotImplementedError … TextDecoder(nope) (only utf-8)` |
| decode `68 69 e9 80 ff` as latin1 / utf-16le / utf-16be / gbk | `hié€ÿ` / `楨胩�` / `桩�` / `hi閫�` | the `NotImplementedError` |
| utf-8 `fatal` on `ff`; `ignoreBOM`; `stream` split of `é` | `TypeError [ERR_ENCODING_INVALID_ENCODED_DATA]`; `﻿A`; `é` | same |
| `util.TextDecoder === TextDecoder`, `util.TextEncoder === TextEncoder` | `true` | same |
| `encodeInto` with a non-`Uint8Array` dest / a non-string src | `TypeError [ERR_INVALID_ARG_TYPE]` | `{read: 1, written: 1}` (`distribution/isolate-guest-textencoder-encodeinto-arg-checks`) |
| pdfkit 0.17.2 `Helvetica`, `compress: false` | exit 0, `out.pdf` | exit 1, `NotImplementedError: … isolate-host.TextDecoder(ascii) (only utf-8)` |

Measured composition inside the real guest bundle (`reference/textdecoder/bundle`, variant `td-gb`):
0 differences from Node over the 33 encodings on the corpus, 200/228 labels equal (the other 28 are
the five's labels, the named gap), 23/23 error and identity cases equal, pdfkit `compress: false`
byte-identical to Node; `dist/guest.js` 7 173 116 → 7 360 337 B, gzip -9 1 512 671 → 1 563 006
(+50.3 KB eager `td-gb`; parts min/gzip: `single-byte.js` 9.3/3.5 KB, `encoding.js` + `util.js` + shims
18.1/6.0 KB, @exodus/bytes trimmed to gb18030 74.5/33.6 KB); warm `runCode('1')` 13.9 → 17.0 ms
(+3.1; Node's class, not the engines — 0.8 ms is the module init, ~2.2 ms unexplained); first use
windows-1252 0.20 ms, utf-16le 1.11 ms, gb18030 2.87 ms. Since the review (`td-lazy`, `td-lazy-fast`):
lazy `single-byte.js` → warm Δ +0.5–0.6 ms; `guest.js` 7 362 480 B / 1 563 337 gzip (+50.7 KB); the utf-8 binding fixed (Acceptance 11); first use
windows-1252 0.63 ms (now evaluates `single-byte.js`), utf-16le 1.57, gb18030 3.51; gb18030's whole
4-byte space (1 587 600) equal to Node (review delegate).

## User scenario

Goal §User scenario step 3: pdfkit with its built-in font loads in the isolate as in Node
(`zlib-scenario.test.ts` case 4, reused by the carrier).

## Acceptance

1. Labels: each of the 228 WHATWG labels (`reference/textdecoder` pins `encodings.json` at
   7d2e3e08e1): `new TextDecoder(label)` gives Node's `encoding`, or Node's `RangeError
   [ERR_ENCODING_NOT_SUPPORTED]` (`replacement`), in `exec` and `runCode`; the 28 labels of big5,
   euc-jp, shift_jis, euc-kr, iso-2022-jp throw `NotImplementedError('isolate-host.TextDecoder(<enc>)')`
   at construction; for those five every corpus case is checked as refused with that gap (a decoder
   that slipped into the bundle, e.g. a WHATWG big5, fails the row) → I2
2. Decoding: the probe's corpus (`reference/textdecoder/cases.cjs`: every single byte, every 2-byte
   sequence, gb18030 4-byte and euc-jp 3-byte forms sampled, random and `stream: true` splits,
   non-fatal and `fatal`, `ignoreBOM`) equals live Node for utf-8 and the 33 encodings — 0
   differences → I2
3. Errors equal Node (class, `code`, `message`): unknown label and `replacement`
   (`ERR_ENCODING_NOT_SUPPORTED`), invalid data under `fatal` (`ERR_ENCODING_INVALID_ENCODED_DATA`)
   for utf-8, utf-16le, gb18030, a single-byte encoding; `decode('x')`/`decode(1)`
   (`ERR_INVALID_ARG_TYPE`), a foreign `this` (`ERR_INVALID_THIS`), invalid `options` → I2
4. WPT `encoding` (Node v24.16.0's vendored copy, sha256-pinned) through the shared WPT harness of
   `tests/wpt/` (`README.md` there; PR #458, ADR-0578): every subtest gives the guest the
   result live Node gives it (not Node's `status/encoding.json`, which still skips files Node now
   passes, `reference/wpt`), except, listed in the test: the `encodeInto` «detached output buffer»
   subtest (`MessageChannel`), `idlharness.any.js` and `encoding/streams/*`
   (`TextDecoderStream`/`TextEncoderStream`), `iso-2022-jp-decoder.any.js` and the subtests of the
   five named-gap encodings, the `SharedArrayBuffer` half of `textdecoder-copy` when the guest
   disables it → I2
5. `TextEncoder` is Node's class from the same `encoding.js`: `encode`, `encodeInto` with Node's
   argument checks (closes `distribution/isolate-guest-textencoder-encodeinto-arg-checks`),
   `encoding`, lone surrogates → I2
6. `util.TextDecoder === TextDecoder` and `util.TextEncoder === TextEncoder` in a file run and in
   `runCode`; `Buffer#toString` paths that go through the global keep their results → I4
11. utf-8 is not slower than today beyond noise, measured before and after in the guest (medians,
    base and change alternating): 20 000 × `new TextDecoder().decode(small)`, 20 000 × a reused
    decoder, 20 000 × small `Buffer#toString()`, 20 × 1 MiB `decode` and `toString`. One utf-8
    decoder: Node's `encoding_binding.decodeUTF8` and `io/src/buffer-codec.ts`'s path call the
    guest codec's whole-input decode function (no per-call decoder, closures or arrays; probe
    `td-lazy-fast`, `bundle/utf8-whole.ts.txt`: 6.22 / 3.64 / 5.56 / 98 / 97 ms vs base 7.72 /
    3.73 / 6.14 / 199 / 198; the first binding, a decoder per call, was +25–38 % slower) → I2
12. fontkit as pdfkit drives it, in the sandbox against live `node`: Helvetica (AFM) asks only
    `ascii`; a TTF (DejaVu Sans 2.37.3: Bitstream Vera / Arev licence + public domain; the committed
    TTF fixture carries its LICENSE beside it, as `apps/playground/public/fonts/LICENSE.md`) asks `ascii`, `utf-16be`, `x-mac-roman` — pdfkit
    0.17.2 + that TTF, `compress: false`, gives Node's `out.pdf` bytes → I2
13. The five's gap at the consumer, pinned (declared ⚠️, compat row of Acceptance 10): the probe's
    font (`bundle/fonts.mjs`: DejaVu Sans with Mac `name` records in shift_jis, big5, euc-kr, gbk)
    through fontkit gives Node's PDF bytes, family names `{ja: 'テスト', ko: '가나', zh: '测试',
    'zh-Hant': '測試'}` in Node and `{ja: 'BYTES 6', ko: 'BYTES 4', zh: '测试', 'zh-Hant': 'BYTES 4'}`
    in the guest, exit 0 — restructure's `readString` catches the throw, so the gap is silent there
    → I2
7. pdfkit 0.17.2 with `Helvetica`, `compress: false`, sandbox `exec` over its closure: exit 0 and
   `out.pdf` byte-identical to live `node` (fixed `CreationDate`) → I2; the scenario's
   `compress: true` run (`zlib-scenario.test.ts` case 4): its isolate pin moves past fontkit's load
   (the zlib gap while the zlib goal's unit 3 is open) → I5
8. Mechanism: Node v24.16.0's `lib/internal/encoding.js`, `encoding/single-byte.js`,
   `encoding/util.js` vendored (sha256-pinned, MIT notice) through the generated-source pipeline of
   ADR-0574 (edit anchors, sha, drift check). Verbatim except one declared anchored edit, the only
   departure: `encoding.js:37`'s `require('internal/encoding/single-byte')` becomes lazy (on the
   first single-byte decoder; the build fails if the anchor line drifts). `encoding_binding` utf-8 →
   the guest codec (row 11); `icu` → @exodus/bytes 1.16.0 exact pin, pure-JS path, its tables
   trimmed to utf-16 and gb18030, loaded on first use; the five throw from Node's own
   `#prepareConverter`; the engine reads no guest `Buffer` (base64url: `node-streams-as-in-node`
   unit 2, `runtime-js/buffer-encoding-names`). A new dependency: an ADR (semantic copy, the
   @exodus/bytes pin, the anchored edit) comes first, and @exodus/bytes gets its entry in
   `tools/publishing/third-party-manifest.json` (PR #445's notices gate, `check:third-party-notices`)
   → I2
9. Cost: `dist/guest.js` bytes and gzip and the warm `runCode('1')` median (≥40, alternating)
   before and after, recorded in the ADR and the isolate-host README; with no non-utf-8 decoder
   created, the warm `runCode('1')` median grows by ≤ 1 ms (probe `td-lazy`: +0.5–0.6 ms, vs +3.3 ms
   eager; `td-lazy-fast` `guest.js` 7 362 480 B / 1 563 337 gzip, +50.7 KB) → ADR-0563
10. Compat `docs/public/compat/isolate-host.md`: a `TextDecoder`/`TextEncoder` row ✅ for utf-8 and
    the 33 encodings, ❌ for the five (named gap, `distribution/isolate-guest-textdecoder-icu-only-encodings`),
    ⚠️ for its silent form at fontkit (row 13: names `BYTES n`, PDF bytes Node's) → I2

## Parity cases

- the pin table's rows (labels: 3 accepted today → 194 accepted + 6 `RangeError` = 200 equal to Node,
  28 the named gap; the `utf-8` aliases, `replacement`, `nope`, the four
  decodes, `encodeInto` checks, pdfkit) — RED except the two rows equal today (utf-8
  `fatal`/`ignoreBOM`/`stream`; the `util` identities), which are guards → I2, I4, I5
- corpus per encoding (`cases.cjs` hashes) for the 33 — RED → I2
- `new TextDecoder('big5')` → `NotImplementedError('isolate-host.TextDecoder(big5)')` — RED (today
  the message says `(only utf-8)`) → I2
- WPT `encoding` under Node's status file, exclusions listed — RED → I2

## Reference contract

Node v24.16.0 `lib/internal/encoding.js`, `lib/internal/encoding/single-byte.js`,
`lib/internal/encoding/util.js`, `test/wpt/test-encoding.js`, `test/wpt/status/encoding.json`;
WHATWG `encoding` @ 7d2e3e08e1 (`encodings.json`, `indexes.json`) for the corpus; @exodus/bytes
1.16.0. Oracle live Node v24.16.0. A Node re-pin regenerates and reruns the corpus.

## Out of scope

- big5, euc-jp, shift_jis, euc-kr, iso-2022-jp: `NotImplementedError('isolate-host.TextDecoder(<enc>)')`,
  compat ❌ (`distribution/isolate-guest-textdecoder-icu-only-encodings`).
- `TextDecoderStream`/`TextEncoderStream`: their ceiling throwers, compat ❌
  (`distribution/isolate-guest-web-streams`).
- `string_decoder` and `Buffer` encodings: goal `node-streams-as-in-node` units 1–2.
- Browser hosts.

## Decisions

- 2026-11-25 — manager: the set is utf-8 + the 33 Node=WHATWG encodings; the five are a named gap
  (goal Decisions, question T).
- 2026-11-25 — WPT through the one shared harness, `tests/wpt/` (built by the `Blob` unit, PR #458).
- 2026-11-25 — @exodus/bytes only for utf-16/gb18030 (Node uses ICU there but its results equal
  WHATWG on the corpus); Node's own JS for the rest.
- rejected route: `text-encoding` 0.7.0 (differs on `iso-8859-8-i` and gbk/gb18030, tables at load
  +4.1 ms), iconv-lite 0.7.3 (no `fatal`, three encodings missing) — violates I2.
- 2026-11-25 — manager (PR #443 review): gbk/gb18030 stay (equal to Node on the full 4-byte space,
  1 587 600 sequences, review delegate); lazy `single-byte.js` is required; utf-8 throughput is an
  acceptance row.
- 2026-11-25 — the +2.2 ms was `single-byte.js` evaluated at load (review delegates; probe
  `td-lazy`) — closed by Acceptance 8's anchored edit.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
