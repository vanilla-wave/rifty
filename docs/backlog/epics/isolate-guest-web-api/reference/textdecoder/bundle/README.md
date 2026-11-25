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
node $P/run.mjs                   # corpus, labels, errors, pdfkit → results.json/.txt
node $P/run.mjs --timing --n 40   # warm runCode('1'), first use → results-timing.json
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
- `td-none`: no utf-16/gb18030 engine (timing attribution).

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
  - td-gb: exit 0, `out.pdf` byte-identical to Node's (sha256 `57158f98bf53450a…`, 1 269 bytes;
    `CreationDate` fixed).

## Finding (outside this probe's scope)

rifty's `Buffer` refuses base64url characters in base64 input. In the base guest,
`Buffer.byteLength('-_8', 'base64')`, `Buffer.from('-_8', 'base64')` and
`Buffer.from('a-b', 'base64')` throw `InvalidCharacterError: Invalid character`; Node returns 2, 2
and `6be6`. @exodus/bytes read the guest's `Buffer` through `globalThis` and died on it, hence the
`Buffer` edits above. Measured in the isolate guest only; browser hosts not run. Item: `runtime-js/buffer-base64-rejects-base64url-chars`.

## Not verified

- Where the ~2.2 ms beyond the module's own 0.8 ms goes, and whether a lazy `single-byte.js` (an edit
  anchor in Node's `encoding.js`) would cut it.
- `util.inspect` of the classes (the probe's `internal/util/inspect` binding is a stub);
  `TextDecoderStream` (out of scope).
- pdfkit with `compress: true` (stops at zlib).
- An exhaustive gb18030 4-byte space (sampled).
- Browser hosts; Linux; timing under other load.
