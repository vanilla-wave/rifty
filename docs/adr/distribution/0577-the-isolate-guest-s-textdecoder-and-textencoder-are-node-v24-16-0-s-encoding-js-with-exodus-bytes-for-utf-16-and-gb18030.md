# ADR 0577: The isolate guest's TextDecoder and TextEncoder are Node v24.16.0's encoding.js, with @exodus/bytes for utf-16 and gb18030

Status: Accepted
Date: 2026-11

> TL;DR: the isolate guest's `TextDecoder`/`TextEncoder` are Node v24.16.0's `lib/internal/encoding.js` + `encoding/single-byte.js` + `encoding/util.js`, generated verbatim but for one anchored edit (the single-byte require made lazy); Node's C++ halves are the guest's one UTF-8 codec and, for what Node decodes by ICU, @exodus/bytes 1.16.0 (utf-16le/be, gb18030) or a named gap (big5, euc-jp, iso-2022-jp, shift_jis, euc-kr).

## Context

Contract: `docs/backlog/distribution/isolate-guest-textdecoder-legacy-encodings.md` (goal
`isolate-guest-web-api` unit 3; deleted on done, its decisions are here, in compat and CHANGELOG);
probes `docs/backlog/epics/isolate-guest-web-api/reference/textdecoder` and its `bundle/`. The guest's
own UTF-8 class accepted 3 of 228 WHATWG labels: pdfkit 0.17.2 died at fontkit's
`new TextDecoder('ascii')`, an unknown label threw `NotImplementedError` where Node throws
`RangeError [ERR_ENCODING_NOT_SUPPORTED]`.

Node v24.16.0 decodes utf-8 in C++, the 28 single-byte encodings and `x-user-defined` in JS
(`single-byte.js`, WHATWG tables), everything else by ICU `ucnv`. On the probe's corpus (every 1- and
2-byte sequence, sampled longer forms, `fatal`, `ignoreBOM`, one `stream` split then a flush) Node
equals WHATWG for utf-16le/be, gbk, gb18030 (gb18030's whole 4-byte space, 1 587 600 sequences:
equal; valid input in any split too). Over several `stream` calls on invalid input it does not
(PR #459 review B2/S1; 50 000 fuzzed scenarios per encoding and mode): Node's binding throws a call
whose output passes its buffer, and ICU keeps the bytes at an error for the decoder's next calls.
It differs, at once, for
big5, euc-jp, shift_jis, euc-kr, iso-2022-jp (ICU's tables and error handling, e.g. an invalid lead
dropped with no U+FFFD even under `fatal`).

## Decision

1. Vendor Node v24.16.0 `lib/internal/encoding.js`, `lib/internal/encoding/single-byte.js`,
   `lib/internal/encoding/util.js` and `LICENSE` under `tools/publishing/node-encoding/vendor/`
   (sha256-pinned). `generate-node-encoding.mjs` checks each module's `require`/`internalBinding`
   ids and `primordials` names against the bindings, and writes
   `isolate-guest/src/guest/node-encoding/generated/`; `check:node-encoding-drift` checks the
   committed output (ADR-0574's pipeline).
2. One declared edit, the only departure from verbatim: `encoding.js:37`'s
   `require('internal/encoding/single-byte')` becomes lazy. The anchor must be exactly line 37 and
   occur once, else the generator fails. `single-byte.js` then evaluates on the first non-utf-8
   decoder (the constructor asks `isSinglebyteEncoding` first), not on every isolate's load
   (eager: +3.3 ms warm `runCode`, probe `td-gb`).
3. Bindings (`node-encoding.ts`), captured at load, before guest code: `primordials`; Node's
   `makeNodeErrorWithCode` shapes (fixed message: own `stack, message, code`; function message:
   `stack, code[, errno], message`; `constructor` → the base; coded `toString`); a C++ binding's
   throw is a plain error with an own `code`; the validators' throw has Node's extra
   `HideStackFramesError` class; a function message is computed before `super`, so V8's stack
   header carries it; validators, `internal/util/types`, `FastBuffer`'s
   `latin1Slice`/`ucs2Slice`/`swap16`. `inspect` and the `ERR_INVALID_ARG_TYPE` message
   (`runtime-js/internal/node-received.ts`, shared with ADR-0574's bindings) are the runtime's,
   bound by the entry once it loads: the shim evaluates before any runtime module.
4. `encoding_binding` → `text-codec.ts`, the guest's one UTF-8 codec (its flags read as Node's C++
   does, `IsTrue()`: `encoding.js` passes its `prefix` bytes as `ignoreBOM`): `decodeUTF8` is a whole-input
   decode (Node's class keeps the stream state) into one reused 32 Ki-unit buffer, no per-call
   decoder, closure or array; `encodeUtf8String`/`encodeInto` its encoder. The guest's own
   `TextDecoder`/`TextEncoder` classes are gone. `io/src/buffer-codec.ts` is unchanged: its
   load-time `new TextDecoder('utf-8', { ignoreBOM: true })` is Node's class here, so
   `Buffer#toString` reaches the same function; browser hosts keep their native classes.
5. `icu`: `getConverter` → @exodus/bytes 1.16.0's `TextDecoder` for utf-16le, utf-16be, gb18030
   (Node passes gbk as gb18030), evaluated on the first such decoder; `decode` maps its `fatal`
   refusal under `fatal` (only then) to Node's C++ `ERR_ENCODING_INVALID_ENCODED_DATA`; its input is
   always a fresh primordial view, a detached or out-of-bounds input no bytes (Node's C++). Node's
   `ConverterObject::Decode` output buffer too: a call that does not flush and would emit more than
   `2 × min_char_size × input length` (gb18030 1, utf-16 2) throws `ERR_ENCODING_INVALID_ENCODED_DATA`.
   Not repeated, being ICU's state, not the binding's: the decoder after an error, and ICU stopping
   on an exactly full buffer with bytes left (portability inventory). The pure-JS path is forced:
   its native paths would read the guest's `Buffer`/`TextDecoder` (this class) and post-ES2022
   builtins, which the ES floor gate (`check:es-floor`, every `packages/*/dist` bundle, `guest.js` of
   both packages included) refuses.
   Generated into `exodus-bytes/generated/` by the same generator: its multi-byte tables trimmed to
   gb18030 (a big5 table cannot slip in); every `globalThis` read → an empty object (no guest
   `Buffer`, `TextDecoder`, `atob`) and every post-ES2022 feature read (`toBase64`, `fromBase64`,
   `toHex`, `fromHex`, `isWellFormed`, `toWellFormed`) → `undefined`, with the native `toBase64`
   branches those guard removed at exact-once anchors: its pure-JS path, under the browser floor
   (ADR-0469; the generator runs `check:es-floor`'s check on its output). Exact pin, root
   devDependency; the generator refuses another version or another set of source files.
6. big5, euc-jp, iso-2022-jp, shift_jis, euc-kr: `getConverter` throws
   `NotImplementedError('isolate-host.TextDecoder(<enc>)')`, so Node's own `#prepareConverter`
   refuses at construction (the user's goal, manager decision 2026-11-25;
   `distribution/isolate-guest-textdecoder-icu-only-encodings`). `replacement`: no converter, so
   Node's `RangeError [ERR_ENCODING_NOT_SUPPORTED]`.
7. Class names are Node's: the generated module keeps identifiers (whitespace/syntax minified
   only), and no other guest-bundle symbol is named `TextDecoder`/`TextEncoder` — the shim exports
   the classes for its inject (the runtime's bare references bind to them, as `DOMException`) and
   `util.ts` exports its globals under other names — so esbuild does not rename them (`Class
   constructor TextDecoder cannot be invoked without 'new'`, `.name`). The source text stays
   esbuild-printed.

## Portability inventory

| Binding | Class / authority | Drift guard | Kill condition |
|---|---|---|---|
| @exodus/bytes for utf-16le/be, gb18030 (Node: ICU) | substitution-environment; Node = WHATWG on the corpus (manager, PR #443 review) | `isolate-host/tests/text-decoder.test.ts` corpus vs live Node; generator version/sha pins | a Node re-pin whose ICU result differs (rerun the corpus) |
| a gb18030/gbk/utf-16 decoder reused after one of its errors (`fatal`, or the output-limit throw) | platform-gap: ICU's converter state (manager, PR #459 review, preliminary; question to the user) | `text-decoder.test.ts` stream rows: counts pinned per encoding | the user's answer |
| a non-flushing gb18030/gbk call whose output fills the limit exactly, bytes left pending (Node throws) | same; 7 of 50 000 fuzzed scenarios | a pinned row | same |
| @exodus/bytes normalizes its label with live `trim`/`toLowerCase` | `backlog/runtime-js/post-guest-paths-use-replaceable-intrinsics` | pinned row | that item |
| the five ICU-only encodings | platform-gap; manager decision 2026-11-25 | the five's corpus rows (every case refused with the gap) | `distribution/isolate-guest-textdecoder-icu-only-encodings` |
| lazy `single-byte.js` (line 37) | the one edit; perf only | generator anchor + line pin | none |
| a Node error's stack header (`RangeError: …`, Node `RangeError [ERR_ENCODING_NOT_SUPPORTED]: …`; `String(e)` has the label) | rifty's stack has no `kIsNodeError` header (`backlog/runtime-js/node-error-code-label`) | none | that item |
| `util.inspect` of the classes | rifty's `inspect` honours no `inspect.custom` (`runtime-js/util-surface-completions`) | pinned `inspect`/`subclass` rows | that item lands |
| live intrinsics on every utf-16/gb18030 call (@exodus/bytes: `String.fromCharCode`, `subarray`, typed-array `length`; `Object.defineProperty` at its first evaluation) and the `length` the codec's `fromCharCode.apply` reads | `backlog/runtime-js/post-guest-paths-use-replaceable-intrinsics` (measured there) | none | that item |

## Alternatives rejected

- Keep a hand-written class and widen it: the same semantic copy without a drift check, ~620 lines.
- `text-encoding` 0.7.0: differs on `iso-8859-8-i`, gbk/gb18030 (2017 indexes), tables at load +4.1 ms.
- iconv-lite 0.7.3: no `fatal`, three encodings missing.
- @exodus/bytes for every encoding: Node's own JS is the oracle for single-byte; untrimmed +112 KB gzip.
- WHATWG decoders for the five: «similar but different» from Node's ICU (AGENTS §Fidelity).
- An ICU converter port: not measured (tables ~36–55 KB gzip each plus its state machine).

## Consequences

- utf-8, the 28 single-byte encodings and `x-user-defined` are Node's in the isolate; gb18030, gbk,
  utf-16le/be are Node's but the two inventory rows above (compat ⚠️); 194 labels + 6
  `RangeError` equal Node, 28 the named gap; errors are Node's class, `code`, message, `String` and
  own keys; `encodeInto` validates as Node (closes `distribution/isolate-guest-textencoder-encodeinto-arg-checks`).
- fontkit/pdfkit load; a CJK Mac `name` record in one of the five reads as raw bytes, silently
  (restructure catches the throw): declared ⚠️ in compat `isolate-host.md`.
- Cost, M3 Pro, 2026-11-26: `guest.js` on main `d19d891b9` (with Blob/File,
  `string_decoder`) 7 229 531 → 7 381 563 B (gzip -9 1 526 604 → 1 573 817, +47 213; generated
  `encoding.js` 25 199 B, `text-decoder.js` 75 795 B). Warm `runCode('1')` median, before the goal
  (`3d16cb7b8`) / main / this, alternating triples, n = 200 each, three runs at load 4–6: this
  change +0.66, +0.67, +0.53 ms; since the goal began +1.22, +1.13, +1.32 (p10–p90 of each ~1–1.6 ms
  wide in the first run; the goal records cost, no hard limit; the build before the review fixes,
  with minified identifiers, at load 3.4–4.1: +0.58 to +0.63 / +1.05 to +1.08; eager `single-byte.js` was +3.3). The class and
  bindings evaluate in ~0.1 ms (a vm context, median of 50). utf-8 faster on every row (small
  fresh/reused decoder −32 %/−12 %, small `toString` −16 %, 1 MiB ~−49 %; isolate-host README
  §Cost). First non-utf-8 decoder per isolate: windows-1252 0.7 ms, utf-16le 2.0, gb18030 4.3.
- WPT `encoding` (Node v24.16.0's copy through the shared harness `tests/wpt/`,
  `isolate-host/tests/wpt-encoding.test.ts`): 20 files, 11 476 subtests as live Node but 34 excluded
  («detached output buffer»: `MessageChannel`; the five's 28 labels and 5 `TextEncoder` rows); 15 of
  the 35 `.any.js` not run, each with its live reason (`idlharness`, `streams/*`: web streams;
  `iso-2022-jp-decoder`: the five; `replacement-`/`unsupported-encodings`: `XMLHttpRequest`, absent in Node too).
- Publishing: both generated dirs carry their notice (`third-party-manifest.json`).
- Re-pin of Node or @exodus/bytes: rerun the generator and `text-decoder.test.ts` (the generator checks ids and primordial names, not the members a module destructures from its bindings: a new one fails only at run time).
