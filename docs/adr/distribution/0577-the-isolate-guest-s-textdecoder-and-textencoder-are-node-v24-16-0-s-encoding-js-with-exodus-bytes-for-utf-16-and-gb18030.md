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
2-byte sequence, sampled longer forms, `fatal`, `ignoreBOM`, `stream`) Node equals WHATWG for
utf-16le/be, gbk, gb18030 (gb18030's whole 4-byte space, 1 587 600 sequences: equal), and differs for
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
   throw is a plain error with an own `code`; validators, `internal/util/types`, `FastBuffer`'s
   `latin1Slice`/`ucs2Slice`/`swap16`. `inspect` and the `ERR_INVALID_ARG_TYPE` message
   (`runtime-js/internal/node-received.ts`, shared with ADR-0574's bindings) are the runtime's,
   bound by the entry once it loads: the shim evaluates before any runtime module.
4. `encoding_binding` → `text-codec.ts`, the guest's one UTF-8 codec: `decodeUTF8` is a whole-input
   decode (Node's class keeps the stream state) into one reused 32 Ki-unit buffer, no per-call
   decoder, closure or array; `encodeUtf8String`/`encodeInto` its encoder. The guest's own
   `TextDecoder`/`TextEncoder` classes are gone. `io/src/buffer-codec.ts` is unchanged: its
   load-time `new TextDecoder('utf-8', { ignoreBOM: true })` is Node's class here, so
   `Buffer#toString` reaches the same function; browser hosts keep their native classes.
5. `icu`: `getConverter` → @exodus/bytes 1.16.0's `TextDecoder` for utf-16le, utf-16be, gb18030
   (Node passes gbk as gb18030), evaluated on the first such decoder; `decode` maps its `fatal`
   refusal to Node's C++ `ERR_ENCODING_INVALID_ENCODED_DATA`. Generated into
   `exodus-bytes/generated/` by the same generator: its multi-byte tables trimmed to gb18030 (a
   big5 table cannot slip in), every `globalThis` read replaced by an empty object, so it reads no
   guest global (no guest `Buffer`, `TextDecoder`, `atob`: its pure-JS path). Exact pin, root
   devDependency; the generator refuses another version.
6. big5, euc-jp, iso-2022-jp, shift_jis, euc-kr: `getConverter` throws
   `NotImplementedError('isolate-host.TextDecoder(<enc>)')`, so Node's own `#prepareConverter`
   refuses at construction (the user's goal, manager decision 2026-11-25;
   `distribution/isolate-guest-textdecoder-icu-only-encodings`). `replacement`: no converter, so
   Node's `RangeError [ERR_ENCODING_NOT_SUPPORTED]`.

## Portability inventory

| Binding | Class / authority | Drift guard | Kill condition |
|---|---|---|---|
| @exodus/bytes for utf-16le/be, gb18030 (Node: ICU) | substitution-environment; Node = WHATWG on the corpus (manager, PR #443 review) | `isolate-host/tests/text-decoder.test.ts` corpus vs live Node; generator version/sha pins | a Node re-pin whose ICU result differs (rerun the corpus) |
| the five ICU-only encodings | platform-gap; manager decision 2026-11-25 | the five's corpus rows (every case refused with the gap) | `distribution/isolate-guest-textdecoder-icu-only-encodings` |
| lazy `single-byte.js` (line 37) | the one edit; perf only | generator anchor + line pin | none |
| `util.inspect` of the classes | rifty's `inspect` honours no `inspect.custom` (`runtime-js/util-surface-completions`) | pinned `inspect`/`subclass` rows | that item lands |
| intrinsics read at call time (@exodus/bytes evaluates on first use; `Uint16Array` `length` in the codec's `fromCharCode`) | `backlog/runtime-js/post-guest-paths-use-replaceable-intrinsics` | none | that item |

## Alternatives rejected

- Keep a hand-written class and widen it: the same semantic copy without a drift check, ~620 lines.
- `text-encoding` 0.7.0: differs on `iso-8859-8-i`, gbk/gb18030 (2017 indexes), tables at load +4.1 ms.
- iconv-lite 0.7.3: no `fatal`, three encodings missing.
- @exodus/bytes for every encoding: Node's own JS is the oracle for single-byte; untrimmed +112 KB gzip.
- WHATWG decoders for the five: «similar but different» from Node's ICU (AGENTS §Fidelity).
- An ICU converter port: not measured (tables ~36–55 KB gzip each plus its state machine).

## Consequences

- utf-8 and the 33 encodings where Node equals WHATWG are Node's in the isolate: 194 labels + 6
  `RangeError` equal Node, 28 the named gap; errors are Node's class, `code`, message, `String` and
  own keys; `encodeInto` validates as Node (closes `distribution/isolate-guest-textencoder-encodeinto-arg-checks`).
- fontkit/pdfkit load; a CJK Mac `name` record in one of the five reads as raw bytes, silently
  (restructure catches the throw): declared ⚠️ in compat `isolate-host.md`.
- Cost: see the isolate-host README §Bundle cost (2026-11-25).
- Publishing: both generated dirs carry their notice (`third-party-manifest.json`).
- Re-pin of Node or @exodus/bytes: rerun the generator and `text-decoder.test.ts`.
