# Probe: the recommended TextDecoder composition inside the real guest bundle

Question (goal `isolate-guest-web-api`, map unit 3, before it goes ready): what does the set chosen
by the manager on 2026-11-25 cost in the guest bundle, and does it equal Node there? The set is
utf-8 plus the 33 encodings where Node equals WHATWG; the five ICU-only ones are a named gap. Probe
only, nothing shipped. Measured 2026-11-25, HEAD `7772f9c2e` (base `dist/guest.js` built from the
same product code, last product change `7a374ce36`), Node v24.16.0, isolated-vm 7.0.2, esbuild
0.28.0, @exodus/bytes 1.16.0, M3 Pro, macOS, load average 1.9–3.6.

## Run

```sh
pnpm install && pnpm --filter @riftydev/isolate-host build                      # the base
node docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/probe.mjs   # once: pins encodings.json
P=docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/bundle
node $P/build.mjs                 # variants + sizes.json
node $P/run.mjs                   # td-lazy-fast: corpus (utf-8 + 33), labels, errors, pdfkit → results.json/.txt; exit 1 on any difference or unfinished run
node $P/run.mjs --variant td-gb   # the same for another variant
node $P/run.mjs --timing --n 60   # warm runCode('1') for base, td-gb, td-lazy, td-lazy-fast, td-none → results-timing.json
node $P/run.mjs --utf8            # utf-8 throughput, base vs variants → results-utf8.json
node $P/fonts.mjs                 # fontkit's labels, a TTF case, the CJK name-table case → results-fonts.json/.txt
```

`build.mjs` rebuilds the guest with `packages/isolate-guest/scripts/build-guest.mjs`'s esbuild
config. One onLoad edit in `web-shim.ts` replaces its two `define('TextEncoder'|'TextDecoder', …)`
lines with Node's classes.
- Node v24.16.0's `lib/internal/encoding.js`, `encoding/single-byte.js` and `encoding/util.js` are
  used verbatim, sha256-pinned and wrapped as a small module registry (`node-encoding.gen.cjs`).
- `shim.cjs` supplies `primordials`, the `internal/*` modules they need, and `internalBinding`:
  - `encoding_binding`: utf-8 goes to the guest's own codec (`text-codec.ts`);
  - `icu`: utf-16le/be and gb18030 (gbk is gb18030's decoder, as in Node) go to @exodus/bytes'
    `TextDecoder`, pure-JS path, loaded by a lazy `require` on first use. The five ICU-only
    encodings throw `NotImplementedError('isolate-host.TextDecoder(<enc>)')` from Node's own
    `#prepareConverter`, at construction.
- @exodus/bytes is pre-bundled for the neutral platform. Every read of `globalThis.Buffer` in it is
  set to `undefined`, so the pure-JS path runs (see the finding below).

Variants live under `packages/isolate-host/node_modules/.web-api-probe/`:
- `td-full`: exodus as published;
- `td-gb`: its multi-byte JSON trimmed to gb18030 (+ ranges, shared chunks);
- `td-none`: no utf-16/gb18030 engine (timing attribution);
- `td-lazy`: td-gb plus **one declared edit at an anchor of Node's `encoding.js`** (line 37, the
  `single-byte.js` require made lazy: evaluated on the first single-byte decoder). The anchor is the
  exact line of the sha256-pinned source and must occur once, or the build fails;
- `td-lazy-fast`: td-lazy with the shim's `decodeUTF8` binding calling a whole-input decode added to
  the guest codec (`utf8-whole.ts.txt`, appended to `text-codec.ts` by an onLoad, probe only) instead
  of constructing a guest `TextDecoder` per call. **The recommended composition.**

## Sizes (`sizes.json`)

| bundle | `guest.js` bytes / gzip -9 | minified / gzip -9 | Δ gzip vs base (guest.js) |
|---|---|---|---|
| base | 7 173 116 / 1 512 671 | 4 391 866 / 1 274 919 | — |
| td-none (class + single-byte) | 7 227 086 / 1 524 090 | 4 420 522 / 1 283 988 | +11 419 |
| **td-gb (the set)** | **7 360 337 / 1 563 006** | 4 496 617 / 1 317 751 | **+50 335** |
| td-full (exodus untrimmed) | 7 769 505 / 1 625 168 | 4 611 470 / 1 376 571 | +112 497 |

Parts, each minified on its own: Node's `single-byte.js` 9 332 / 3 501; `encoding.js` + `util.js`
+ `shim.cjs` 18 128 / 5 966; @exodus/bytes trimmed to gb18030 74 505 / 33 597 (it also carries its
own utf-8 and single-byte code and labels, which the set does not use); untrimmed 189 358 / 91 148.

## Timing (`results-timing.json`, median of 40, base and variants alternating)

| | warm `runCode('1')` |
|---|---|
| base | 13.9 ms |
| td-gb | 17.0 ms (+3.1) |
| td-none | 17.0 ms (+3.0) |

The cost is Node's class, not the engines: td-gb equals td-none. Bisected on ad-hoc copies (not kept):
- the variant with the code bundled but `makeNodeEncoding` not called equals the base (bundle eval
  6.4 ms vs 6.2 ms);
- with the call, bundle eval is 9.3 ms;
- the call itself measures 0.8 ms (`bridge.now()` around it).

Where the other ~2.2 ms goes is not established (allocation/GC later in the boot is a guess).

First use inside the guest (median of 10 fresh isolates; first `new TextDecoder(label).decode(…)`,
then a second one):
- windows-1252: 0.20 ms, then 0.03;
- utf-16le: 1.11 ms, then 0.06 (loads exodus);
- gb18030: 2.87 ms, then 0.06 (exodus + its table).

## Agreement with Node, inside the guest (`results.txt`, variant td-gb)

- Corpus (`../cases.cjs`, every single byte, every 2-byte sequence, gb18030 4-byte and euc-jp
  3-byte forms sampled, random and `stream: true` splits; non-fatal and fatal; per-case hash):
  **0 differences over the 33 encodings of the set**. The five ICU-only refuse at construction by
  design.
- Labels: 200 of 228 WHATWG labels give Node's `encoding` or Node's `RangeError
  [ERR_ENCODING_NOT_SUPPORTED]` (`replacement`). The 28 others are the five ICU-only encodings'
  labels, each the named gap.
- The 23 error/identity cases all equal Node:
  - `new TextDecoder('nope')`, invalid `options`;
  - `fatal` errors for utf-8, utf-16le, gb18030 and windows-1253 (`TypeError
    [ERR_ENCODING_INVALID_ENCODED_DATA]`);
  - `decode('x')`/`decode(1)` with the C++ bindings' plain messages;
  - `ERR_INVALID_THIS`, getters, `Symbol.toStringTag`;
  - `util.TextDecoder === TextDecoder` and `util.TextEncoder === TextEncoder`;
  - `encodeInto` with a non-`Uint8Array` dest and a non-string src (`ERR_INVALID_ARG_TYPE`, which
    fixes `distribution/isolate-guest-textencoder-encodeinto-arg-checks` in this variant);
  - `encode()`, a lone surrogate, utf-8 `stream` split;
  - `Buffer#toString` going through the new global.
- pdfkit 0.17.2, `Helvetica`, `compress: false`, sandbox `exec` over its closure vs `node`:
  - base: exit 1 `NotImplementedError: … isolate-host.TextDecoder(ascii) (only utf-8)`;
  - td-gb (round 1; td-lazy-fast in round 2): exit 0, `out.pdf` byte-identical to Node's (sha256 `57158f98bf53450a…`, 1 269 bytes;
    `CreationDate` fixed).

## Finding (outside this probe's scope)

rifty's `Buffer` refuses base64url characters in base64 input. In the base guest,
`Buffer.byteLength('-_8', 'base64')`, `Buffer.from('-_8', 'base64')` and
`Buffer.from('a-b', 'base64')` throw `InvalidCharacterError: Invalid character`; Node returns 2, 2
and `6be6`. @exodus/bytes read the guest's `Buffer` through `globalThis` and died on it, hence the
`Buffer` edits above. Measured in the isolate guest only; browser hosts not run. Owner: `runtime-js/buffer-encoding-names` (goal `node-streams-as-in-node` unit 2; inputs `a-b`, `-_8` handed to it by the manager, PR #443 review N3).

## Not verified

- (round 1) Where the ~2.2 ms beyond the module's own 0.8 ms goes — answered in round 2: `single-byte.js`'s
  evaluation at load; the lazy edit removes it.
- `util.inspect` of the classes (the probe's `internal/util/inspect` binding is a stub);
  `TextDecoderStream` (out of scope).
- pdfkit with `compress: true` (stops at zlib).
- An exhaustive gb18030 4-byte space (sampled).
- Browser hosts; Linux; timing under other load.

## Round 2 (2026-11-25, after external review of PR #443)

Measured at HEAD `230c3272a` (product code unchanged since round 1), load average 3.2–4.9 (other
work on the machine). Results now come from `td-lazy-fast` unless named.

**S5 — `run.mjs` counted an unfinished corpus run as 0 differences.** Fixed. An in-set encoding whose
guest run exits ≠ 0 now counts all of its cases as differing. An ICU-only encoding must refuse
with its named gap; any other exit is a failure too. The script exits 1 on a corpus difference, an
unfinished run, a label other than the five's, a differing error case or a pdfkit mismatch. Check:
`--variant td-none` (no utf-16/gb18030 engine) exits 1 with 323 180 differences. `td-lazy-fast`
exits 0.

**Corpus.** It now includes utf-8 (`cases.cjs` `utf8Cases`: every 2-byte sequence, 3- and 4-byte
sequences over boundary continuation bytes, BOM rules, 4 000 random valid/invalid mixes, stream
splits; 78 998 cases), because the utf-8 binding changed. `td-lazy-fast` results:
- 0 differences over utf-8 and the 33, 0 unfinished runs;
- labels 200/228 equal Node, the other 28 are the five's named gap;
- every error and identity case equal;
- pdfkit Helvetica byte-identical (`results.txt`).

**Warm `runCode('1')`** (`results-timing.json`, median, base and variants alternating):

| | n = 40 | n = 60 | p10–p90 (n = 60) |
|---|---|---|---|
| base | 14.72 | 14.85 | 13.69–15.45 |
| td-gb (eager) | 18.04 | 18.13 | 17.90–18.79 |
| td-lazy | 15.29 | 15.36 | 15.11–15.77 |
| td-lazy-fast | 15.29 | 15.41 | 15.17–15.93 |

With no non-utf-8 decoder created, td-lazy costs +0.5–0.6 ms over base (eager: +3.3). That is inside
base's own p10–p90 spread of ~1.8 ms, but the shift is systematic in both runs. The remaining cost
is Node's `encoding.js`/`util.js` and the shim evaluating at load (not bisected further). First use
in the guest: windows-1252 0.63 ms, now including `single-byte.js`'s evaluation; utf-16le 1.57 ms;
gb18030 3.51 ms. A second decoder takes ≤ 0.07 ms.

**utf-8 throughput** (`results-utf8.json`; 9 runs per variant, median ms; the small input is
`'hello world, привет'`, 26 bytes):

| | 20 000 × `new TextDecoder().decode(small)` | 20 000 × reused `d.decode(small)` | 20 000 × `small.toString()` | 20 × decode 1 MiB | 20 × `toString()` 1 MiB |
|---|---|---|---|---|---|
| base | 7.72 | 3.73 | 6.14 | 199.2 | 197.8 |
| td-gb | 10.10 | 5.11 | 7.47 | 199.9 | 198.4 |
| td-lazy | 10.19 | 5.12 | 7.54 | 200.2 | 196.8 |
| td-lazy-fast | 6.22 | 3.64 | 5.56 | 98.3 | 97.4 |

- Cause of td-gb's +37 % on a reused decoder and +22 % on `toString`: the probe's `decodeUTF8`
  binding built a fresh guest `TextDecoder` for every call, on top of Node's own checks.
  (`Buffer#toString` goes through a decoder captured at load, `io/src/buffer-codec.ts:26`, so the
  binding is on its path too.) Reusing guest decoders per flag pair cut only a little (reused 4.71,
  `toString` 7.09): the guest's decode itself builds two closures and a `number[]` per call.
- Fix (td-lazy-fast): the binding calls one closure-free whole-input decode. It writes into a
  reused `Uint16Array` (≤ 64 Ki units; larger inputs get their own) and flushes 32 Ki units per
  `fromCharCode.apply`. The algorithm is the guest class's: maximal subpart → U+FFFD, the
  leading-BOM rule. Node's class keeps the stream state itself, so the binding only ever sees
  whole inputs.
- Result: not slower than base on any row. Small inputs are equal within noise or faster, 1 MiB is
  ~2× faster.
- In the unit the guest's `TextDecoder#decode` would call the same function, so there is one utf-8
  decoder. It must keep the codec's primordial captures: the probe calls `subarray` and
  `String.fromCharCode.apply` live.

**fontkit's labels and the CJK consumer** (`fonts.mjs`, `results-fonts.txt`; pdfkit 0.17.2, fontkit
2.0.4, `compress: false`):
- Helvetica (AFM) asks for `ascii` only. A TTF (DejaVu Sans 2.37.3 from npm) asks for `ascii`,
  `utf-16be` and `x-mac-roman` (= `macintosh`). Both PDFs are byte-identical to Node's in td-lazy-fast
  (sha256 `57158f98…` and `10fdaa4a…`); base exits 1 at `TextDecoder(ascii)`.
- CJK name records: DejaVu Sans with Mac-platform family names added (synthetic, built by
  `fonts.mjs`; Apple's CJK fonts carry such records but are not redistributable). fontkit asks for
  `shift-jis`, `big5`, `euc-kr` and `gbk`.
  - The PDF is byte-identical to Node's.
  - fontkit's `name` table: Node `{"ja":"テスト","ko":"가나","zh":"测试","zh-Hant":"測試"}`; the
    guest `{"ja":"BYTES 6","ko":"BYTES 4","zh":"测试","zh-Hant":"BYTES 4"}`.
  - The named gap of the five is thrown and caught inside fontkit/restructure, so the consumer
    sees raw bytes silently (exit 0). gbk (in the set) decodes.

**Sizes** (`sizes.json`): td-lazy and td-lazy-fast are 7 360 920 / 1 563 115 gzip, base
7 173 116 / 1 512 671, so +50.4 KB gzip. Minified: 4 496 806 / 1 317 829.

## Not verified (round 2)

- Where td-lazy's remaining +0.5–0.6 ms goes (Node's class and shim at load; not bisected).
- The real codec refactor (class decode on the whole-input function, primordial captures); the
  probe appends a second function.
- `util.inspect` of the classes; `TextDecoderStream` (out of scope); pdfkit `compress: true` (zlib).
- A real CJK font with Mac legacy-encoded names (the case is synthetic); fonts whose name records
  use the Windows platform in shift_jis/big5/euc-kr (fontkit maps Windows 2/4/5 to the same labels).
- Browser hosts; Linux; timing on a quiet machine.

