# Probe: where the isolate guest's `TextDecoder` encodings come from

Question (goal `isolate-guest-web-api`, narrowed 2026-11-25): the guest's `TextDecoder`
(`packages/isolate-guest/src/guest/text-codec.ts`) accepts only utf-8, and fontkit (pdfkit 0.17.2)
dies at load on `new TextDecoder('ascii')` (`backlog/distribution/isolate-guest-textdecoder-legacy-encodings`).
Which encodings does Node 24 decode and how? Does its result match the WHATWG Encoding Standard?
Which source gives the isolate Node's result, at what size and cost? Measured 2026-11-25, Node v24.16.0
(ICU 78.3, Unicode 17.0), esbuild 0.28.0, isolated-vm 7.0.2, M3 Pro, load average 4.3–4.8.

## Run

```sh
node docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/probe.mjs [--timing] [--json out.json]
```

Run it from the repo root after `pnpm install`. It needs network access for two things:
- `raw.githubusercontent.com`: Node v24.16.0's `lib/internal/encoding.js`, `encoding/single-byte.js`
  and `encoding/util.js`, plus `whatwg/encoding` at `7d2e3e08e1` (`encodings.json`, `indexes.json`).
  Every file is sha256-pinned in `probe.mjs` and cached in `$TMPDIR/rifty-textdecoder-probe`.
- the npm registry, for `npm ci` of `deps/`.

Evidence: `results.txt` and `results.json` (a `--timing` run).

How it works:
- `cases.cjs` builds the corpus.
- `spec-decoder.cjs` is the spec reference: the Encoding Standard's decoders written from the spec
  text over its `indexes.json`.
- Each candidate is bundled the way the guest is bundled (esbuild IIFE, `browser`; `@exodus/bytes`
  `neutral`, see the note in `probe.mjs`). It runs in a bare V8 context after the guest's own prelude
  (its UTF-8 `TextEncoder`/`TextDecoder` from `text-codec.ts`, a copy of its `DOMException`).
- Every case is compared with live Node: the non-fatal output, plus `fatal`'s outcome (throws or not,
  and the output).

The corpus, for each of the 38 encodings other than utf-8 and replacement:
- all 256 single bytes;
- for the 7 multi-byte encodings and utf-16le/be, every 2-byte sequence (65 536);
- every `8F xx yy` for euc-jp;
- 22 000 4-byte sequences for gbk/gb18030;
- 3 000 random 1–10-byte sequences;
- 1 000 sequences split at a random point (`stream: true`);
- BOM cases for utf-16, with `ignoreBOM` set both ways.

## Node v24.16.0

- **Labels:** all 228 WHATWG labels give the spec's encoding name. `replacement` and its labels throw
  `RangeError` `ERR_ENCODING_NOT_SUPPORTED`, as the spec requires. `ascii`/`latin1`/`iso-8859-1` →
  `windows-1252`.
- **Decoding** (`lib/internal/encoding.js`):
  - utf-8 goes through `encoding_binding.decodeUTF8` (C++);
  - the 28 single-byte encodings and `x-user-defined` go through **JS**:
    `lib/internal/encoding/single-byte.js`, Node's own copy of @exodus/bytes' WHATWG tables. The file
    is 13.6 KB, its tables 9 KB min / 3.2 KB gzip;
  - everything else — utf-16le/be, gbk (via gb18030's converter), gb18030, big5, euc-jp, iso-2022-jp,
    shift_jis, euc-kr — goes through **ICU** `ucnv_toUnicode` (`src/node_i18n.cc`). `fatal` sets
    `UCNV_TO_U_CALLBACK_STOP`, and an error is `TypeError` `ERR_ENCODING_INVALID_ENCODED_DATA`
    «The encoded data was not valid for encoding <name>».
- **`TextEncoder`:** utf-8 only. Its `encodeInto` validates `src` (string) and `dest` (Uint8Array)
  with `ERR_INVALID_ARG_TYPE`.

### Node vs the Encoding Standard

These are the differing cases out of all cases. `nf` counts the ones whose non-fatal output differs.
`m` counts the ones where neither side has U+FFFD, that is, both decoded "successfully" to different
text.

| encodings | Node = spec? |
|---|---|
| 28 single-byte, `x-user-defined` | yes, 0/256 each (Node's code is the spec's tables) |
| utf-16le, utf-16be | yes, 0/69 798 each |
| gbk, gb18030 | yes, 0/91 792 each |
| big5 | **no: 8 401/69 792** (nf 8 385, m 5 363) |
| euc-jp | **no: 16 681/78 628** (nf 16 633, m 41) |
| shift_jis | **no: 3 121/69 792** (nf 3 115, m 1 242) |
| euc-kr | **no: 19 530/69 792** (nf 19 481, m 2 492) |
| iso-2022-jp | **no: 26/69 792** (nf 26, m 0) |

The five differing encodings are ICU's converters, not WHATWG's. Examples (Node vs spec):
- an invalid lead byte is dropped silently, with no U+FFFD and no throw even under `fatal`:
  euc-kr/euc-jp/big5 `80`, `81` → `''` (spec `�`, fatal throws);
- euc-kr `81 41` → `'A'`: the lead is dropped and its trail decoded as ASCII. The spec gives `갂`, so
  Node's euc-kr is plain KS X 1001 without the windows-949 range;
- big5 `88 62` → `''` (spec `Ê̄`);
- shift_jis rotates control bytes, `1a`→`U+001C`, `1c`→`''`, `7f`→`U+001A` (spec: identity), and
  `80` → `�` (spec `U+0080`);
- iso-2022-jp `1b 24` → `'�'` (spec `'�$'`).

Two independent implementations of the spec agree with each other on every count above
(`spec-decoder.cjs` and @exodus/bytes, rows below), so the difference is Node's.

## Candidates for the isolate

| candidate | min / gzip | added per isolate (eval) | first decode (table build) | differs from Node |
|---|---|---|---|---|
| @exodus/bytes 1.16.0 (`encoding.js`, pure-JS path) | 189 029 / 91 408 B (everything) | +0.38 ms | windows-1252 0.35 ms, utf-16le 0.29, shift_jis 2.9, gb18030 3.2 (then 0.05) | = the spec column: 0 except big5/euc-jp/shift_jis/euc-kr/iso-2022-jp (same counts) |
| text-encoding 0.7.0 | 549 003 / 194 046 B | +4.1 ms (tables eager) | 0.15–0.19 ms | spec's 5 + iso-8859-8-i 128/256, gbk 6 336, gb18030 6 347 (2017 indexes), euc-kr 23 891 |
| iconv-lite 0.7.3 (+ `buffer`, `string_decoder` polyfills) | 527 481 / 201 502 B | +0.40 ms | 1.2–6.7 ms | no `fatal` mode, no x-mac-cyrillic/x-user-defined/iso-2022-jp; non-fatal differs on every multi-byte encoding (gbk 21 578, big5 13 183, utf-16le 5 246, …) |
| Node's own `single-byte.js` (verbatim) | tables 9 047 / 3 197 B | not measured | not measured | 0 by construction (it is Node's code) |

Tables inside @exodus/bytes, JSON / gzip: big5 53 463 / 29 795; gb18030 33 143 / 16 994 (+ ranges
1 132 / 473); euc-kr 27 841 / 13 303; jis0208 17 852 / 10 309 (shift_jis, euc-jp, iso-2022-jp);
jis0212 15 492 / 4 317 (euc-jp). They are built on the first `new TextDecoder(label)`, which is the
2.9–3.2 ms above; nothing is built at load.

The guest's `TextEncoder` differs from Node's in 2 of 11 cases: `encodeInto('a', new Uint16Array(2))`
and `encodeInto(1, new Uint8Array(2))` return `{read: 1, written: 1}` where Node throws
`ERR_INVALID_ARG_TYPE`. Encoding itself (lone surrogates, astral, a short `dest`) is equal.

## Recommendation

The source is Node's own wherever Node's decoder is JS, and spec tables wherever Node's ICU result
equals the spec:
- the class: Node's `lib/internal/encoding.js` `TextDecoder` verbatim (labels, validation, errors,
  `inspect`, streaming, BOM), with `encoding_binding.decodeUTF8` bound to rifty's existing UTF-8
  decoder;
- single-byte and `x-user-defined`: Node's `single-byte.js` verbatim (3.2 KB gzip);
- utf-16le/be, gbk, gb18030 — `internalBinding('icu')` there: a JS backend equal to Node on the whole
  corpus, @exodus/bytes' decoders (gb18030 tables ~17.5 KB gzip, built on first use). Not bundled
  standalone, so that size is an estimate.

big5, euc-jp, shift_jis, euc-kr and iso-2022-jp: no measured source gives Node's (ICU's) result. A
WHATWG implementation would be "similar but different" (AGENTS.md §Fidelity). The two honest options:
- a named gap per encoding, `NotImplementedError('isolate-host.TextDecoder(<enc>)')`, as today;
- a port of ICU's converters (its MBCS data and the `ucnvmbcs` state machine). Not measured.

Choosing between them is the goal's call. What fontkit 2.0.4 asks under pdfkit 0.17.2 (measured
later, `bundle/results-fonts.txt`): Helvetica (AFM) only `ascii`; a TrueType font `ascii`,
`utf-16be`, `x-mac-roman`; a CJK font's Mac `name` records `shift-jis`, `big5`, `euc-kr`, `gbk`
(the earlier «ascii, latin1, utf-16le, utf-16be» was not measured — corrected by the PR #443 review).

Not part of this probe, noted for their owners: `util.TextDecoder` is `globalThis.TextDecoder`,
captured by runtime-js at load (`builtins/util.ts:671`). The guest installs its `TextDecoder` before
the runtime, so identity holds as long as the global is not replaced later. `string_decoder` wires
utf-8 only (`builtins/string_decoder.ts:28`, owned by the streams goal's unit 1). `Buffer.toString('latin1')`
does not go through `TextDecoder`.

## Not verified

- A bundle of the recommended composition: Node's `encoding.js` + `single-byte.js` + an @exodus/bytes
  backend for utf-16/gb18030 only. Its size and eval cost are estimates from the parts.
- Inside the real guest bundle (rifty's runtime loaded); `inspect` output; `TextDecoderStream`.
- Multi-byte inputs longer than 10 bytes beyond the random set; gb18030 4-byte beyond 22 000 samples;
  utf-8 (not in scope, the guest has it).
- An ICU-converter port (size, fidelity); Chromium's results for these encodings.
- Linux; timings on a loaded machine (one run, load average 4.3–4.8).

## Rough size of a Node-derived table for the five ICU-only encodings (2026-11-25)

`node docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/icu-dump-size.cjs` — live
Node v24.16.0's output for every 2-byte sequence with a high lead byte (and euc-jp's 3-byte `8f`
form), NUL-joined, gzip -9 (`results-icu-dump-size.txt`): big5 52 KB, euc-jp 49 KB, shift_jis
55 KB, euc-kr 36 KB. An upper-bound-style dump, not a table format; iso-2022-jp is stateful
(escapes) and not measured by it; ICU's converter state machine (lead-byte drops, `fatal`
without a throw) would have to be ported too. Not a recommendation.

## Round 2 note (2026-11-25)

`cases.cjs` gained a utf-8 corpus (`utf8Cases`, 78 998 cases), used by `bundle/run.mjs` only (this
probe's own runs cover the 38 non-utf-8 encodings, unchanged). The composition's round-2 results —
lazy `single-byte.js`, the utf-8 binding fix, fontkit's labels and the CJK name-table case — are in
`bundle/README.md` §Round 2.
