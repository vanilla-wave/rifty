# Probe: sources for the native-backed Web APIs in the isolate guest (URL, URLSearchParams, Blob/File, structuredClone)

Question (goal `isolate-guest-web-api`, manager question 1): where each API's implementation
comes from — own JS, generated from Node's sources (ADR-0541 precedent), an npm package, or a
bridge to the host Node (isolate only). Per candidate we measure bundle size, added time per warm
call and agreement with Node 24. Measured 2026-11-24 at `origin/main` 1c00c6292, M3 Pro, Node
v24.16.0, isolated-vm 7.0.2, esbuild 0.28.0, load average 2.2–2.5 on 12 cores.

## Run

```sh
# parity + sizes (network: registry.npmjs.org, raw.githubusercontent.com for Node's WPT fixtures, sha256-pinned)
node docs/backlog/epics/isolate-guest-web-api/reference/sources-native/probe.mjs --json results-parity.json
# timing only (run on a quiet machine)
node docs/backlog/epics/isolate-guest-web-api/reference/sources-native/probe.mjs --timing --json results-timing.json
```

How it works: `deps/` (exact lock) is `npm ci`'d into a temp dir. Each candidate is bundled the
way the guest bundle is built (`scripts/build-guest.mjs`: esbuild IIFE, `platform: browser`, not
minified; the minified size is listed for reference). It is then evaluated in a bare isolated-vm
isolate after `src/prelude.js`, which carries the guest's own `TextEncoder`/`TextDecoder` (imported
from `packages/isolate-guest/src/guest/text-codec.ts`) and a copy of its `DOMException`.
`cases.js` runs in that isolate and in live Node, and each case's description is compared as text.
- URL: every object case of Node v24.16.0's WPT `urltestdata.json` (886) and `setters_tests.json`
  (278), plus 13 shape cases.
- URLSearchParams: 30 cases.
- structuredClone: 33 cases.
- Blob/File: 19 cases.

A "value" diff means the results differ and at least one side did not throw. An "error" diff means
both sides threw with a different error (name, message or `code`).

Timing: each sample is a fresh isolate with the code cache produced by an earlier compile, as
`packages/isolate-host/src/child/main.ts` does; median of 40. The empty-script baseline is
subtracted. **install** = evaluating the candidate. **first use** = one call on top of install.
**loop** = 10 000 calls in one isolate, median of 5. The numbers add to the guest bundle (7 123 270
bytes, warm call 13–16 ms, ADR-0563); they were not measured inside it.

Bridges (`src/url-bridge.js`, `src/clone-bridge.js`): one synchronous `ivm.Callback`. The URL host
side is Node's `URL.parse` / setters (ada), returning 11 strings. The structuredClone host side is
the identity function: isolated-vm copies the argument and the result with ExternalCopy semantics
(V8 ValueSerializer).

## What is C++ in Node v24.16.0

| API | JS in Node | C++ (`internalBinding`) | generate from Node source? |
|---|---|---|---|
| `URL` | `lib/internal/url.js` (53 KB): class shell, `ERR_INVALID_URL`, inspect, setters glue, `pathToFileURL`, `createObjectURL` | `url`: `parse`, `canParse`, `update` (13 uses), `urlComponents` offsets, `getOrigin`, `pathToFileURL`, `domainToASCII`/`Unicode` — the parser is ada; `url_pattern` (`URLPattern`) | shell yes, parser no: the parser must come from JS (or ada→wasm, not measured: no npm build exists) |
| `URLSearchParams` | all of it (`lib/internal/url.js` class 16 KB, `parseParams`, `internal/querystring` 3.3 KB) | none | yes |
| `Blob` | `lib/internal/blob.js` (14 KB): WebIDL conversion, type/endings, slice bounds, `text`/`arrayBuffer`/`bytes`/`stream` glue | `blob`: `createBlob`, `concat`, `getDataObject`, handle `slice`/`getReader` — the byte store | yes, with the binding replaced by a JS byte store (the ADR-0541 "portability edits bind private primitives" shape); `stream()` needs web `ReadableStream` (lazy require) |
| `File` | `lib/internal/file.js` (3 KB) over Blob | none of its own | yes |
| `structuredClone` | `lib/internal/worker/js_transferable.js` wrapper: WebIDL options, `transfer`, `ERR_MISSING_ARGS` | `messaging.structuredClone` = V8 ValueSerializer + Node host objects | wrapper yes; the serializer must be own JS |

## Result

| API | candidate | bytes (gzip; min) | install ms | first use ms | 10k calls ms | value diffs vs Node | error diffs | trust boundary |
|---|---|---|---|---|---|---|---|---|
| URL | whatwg-url 17.3.0 | 898 178 (193 177; 495 018) | — | — | — | does not load: `@exodus/bytes` builds `TextDecoder('latin1')` at load, the guest's decoder is UTF-8 only | | in-isolate |
| URL | whatwg-url 15.1.0 (last without `@exodus/bytes`) | 402 016 (82 790; 293 380), of it tr46's UTS #46 table 272 311 | **3.79** | 1.06 | 98.5 | WPT 0/886, setters 0/278; shape 4/13 (no `createObjectURL`/`revokeObjectURL`; an own `Symbol(impl)` key; no `inspect.custom`; `name` `URL2` from the bundler) | 275/886 parse failures with another message (`Invalid URL: <input>`, no `code: 'ERR_INVALID_URL'`) | in-isolate |
| URL | whatwg-url 15.1.0, tr46 loaded on first domain-to-ASCII | 402 082 | 0.82 | 4.19 for http(s); **0.60** for a `file:` URL | 97.5 | as above | as above | in-isolate |
| URL | whatwg-url 15.1.0, whole package on first global read | 400 994 | 0.05 | 5.22; 4.71 for `file:` | 98.7 | as above | as above | in-isolate |
| URL | core-js 3.51.0 `actual/url` | 203 859 (32 053; 52 427) | 2.30 | 0.47 | 122.4 | WPT **51**/886 (e.g. `http://a.b.c.xn--pokxncvks` parses, Node rejects it; its IDNA has no punycode validity check), setters 6/278 (`host := xn--`) | 267 | in-isolate |
| URL | bridge to host ada | 1 997 (822) | 0.04 | 0.03 | 106.9 (Node native 4.1) | WPT 0/886, setters 0/278 by construction; shape 5/13 (probe class only) | 1 | new host function over guest strings |
| URLSearchParams | whatwg-url 15.1.0 / core-js | (in the URL bundles) | | | | 2/30 for both: `new URLSearchParams(null)` → `'null='` (Node `''`), no `inspect.custom` | 3/30 (Node's `ERR_INVALID_TUPLE`, `ERR_MISSING_ARGS`) | in-isolate |
| structuredClone | @ungap/structured-clone 1.4.0 | 8 216 (2 110) | 0.02 | 0.18 | 13.3 | **13**/33: subarray offset, DataView window, resizable ArrayBuffer, `cause` dropped, AggregateError, sparse holes filled, … | 2 | in-isolate |
| structuredClone | core-js 3.51.0 `actual/structured-clone` | 181 499 (27 054; 43 892) — 156 322 of it core-js internals | **3.37** | 0.13 | 9.7 (Node native 8.2) | **2**/33: AggregateError stays AggregateError (Node: `Error`), `length` 1 (Node 2) | 7 (messages: `Uncloneable type: Function` vs Node `() => 1 could not be cloned.`) | in-isolate |
| structuredClone | bridge (ExternalCopy round trip) | 629 (370) | 0 | 0.03 | 102.2 | 3/33: resizable ArrayBuffer flattened, `transfer` not done, an invalid transfer list accepted | 6 (`TypeError` where Node throws `DataCloneError`) | the guest's whole graph is materialized in the host realm, outside the isolate heap limit |
| Blob/File | formdata-node 6.0.3 | 14 501 (3 892) | 0.05 | 0.10 | | **9**/19: `text()`/`arrayBuffer()` need web `ReadableStream` (`ReferenceError`), type not lowercased, no `endings`, no `bytes()` | 4 | in-isolate |
| Blob/File | blob-polyfill 9.0.20240710 | 24 452 (5 673) | 0.16 | 0.09 | | **13**/19: binary parts rejected, `size` wrong, UTF-8 lost | 3 | in-isolate |
| Blob/File | fetch-blob 4.0.0 | — | | | | not buildable as the guest's IIFE: top-level `await import('node:stream/web')` | | |

Node quirks found that a spec-faithful package does not have, and a Node-faithful guest must
reproduce:
- `new URLSearchParams(null)` → `''`.
- Blob `endings: 'native'` turns `\r\n` into `\n` but keeps a lone `\r` (`'a\r\nb\rc\n'` → `'a\nb\rc\n'`).
- `structuredClone()` with no argument throws `The "The value argument must be specified" argument must be specified`.
- `structuredClone` returns an AggregateError as a plain `Error`.
- A URL parse failure is `TypeError: Invalid URL` with `code: 'ERR_INVALID_URL'` and `input`.

## Reading

- **URL**: use whatwg-url 15.1.0's parser — it agrees with Node's ada on all 886 WPT cases and all
  278 setter cases. Put Node's own JS shell around it, generated from `lib/internal/url.js`
  (errors, inspect, `searchParams` linkage, `createObjectURL` over the Blob store). Load tr46 on
  first use: eager evaluation costs +3.8 ms per warm call (25–30 % of 13–16 ms); deferred, a
  `file:` URL — the runtime's own use — costs +0.6 ms and the first http(s) host +4.2 ms.
  - whatwg-url 17 cannot load in the guest without a latin1 `TextDecoder`.
  - core-js accepts URLs Node rejects (51 WPT cases).
  - The bridge is no faster (107 vs 98 ms per 10k calls: the callback costs ~10 µs, like the JS
    parse). It would add a host C++ parser over hostile guest strings, copied outside the isolate
    heap limit. That means an ADR-0557 §6 amendment (today's host functions are only `write`,
    `timerStart`/`timerClear`, `now`, `random` — `packages/isolate-guest/src/contract.ts`), with no parity gain over whatwg-url.
- **URLSearchParams**: generate from Node's JS (pure JS in Node, with Node's `null` quirk); neither
  package has the quirk.
- **Blob/File**: generate Node's `blob.js`/`file.js` over a JS byte store. No package passes:
  formdata-node needs web streams even for `text()`, blob-polyfill is broken on binary parts, and
  fetch-blob cannot build.
- **structuredClone**: own JS with V8 serializer semantics behind Node's `js_transferable.js`
  wrapper; core-js's algorithm is the closest reference (2 value diffs). Do not use its whole
  entry: +3.4 ms install from 156 KB of core-js internals. The bridge breaks the isolate memory
  limit (the graph is materialized in the host) and is 10× slower per call. The size and time of
  the own JS were not measured. rifty already has the clone admission walk for
  `markAsUncloneable` (`packages/runtime-js/src/internal/clone-admission.ts`), which it must reuse.

## Not verified

- Candidates were evaluated in a bare isolate with the guest's codec and DOMException copy, not
  inside the guest bundle with rifty's runtime loaded (seam probe's job). Timing is from one run
  at load ~2.3.
- Generated-from-Node variants (no generator written; sizes above are Node's source bytes), the
  own-JS structuredClone, and ada compiled to wasm.
- `Blob.stream()`, `structuredClone` of Blob/File/host objects, `markAsUncloneable`, `util.inspect`
  output, `URL.createObjectURL`, `url.domainToASCII`; browser hosts.
- Error stacks of cloned errors (only `typeof stack` compared).

Files: `probe.mjs`, `cases.js`, `src/` (prelude, bridge candidates), `deps/` (manifest + lock),
`results-parity.json`, `results-timing.json`.

## IDNA in `new URL` host parsing (added 2026-11-24, after the manager's IdnaTestV2 measurement)

```sh
curl -sSL -o /tmp/IdnaTestV2.txt https://www.unicode.org/Public/17.0.0/idna/IdnaTestV2.txt
mkdir -p /tmp/w && (cd /tmp/w && npm init -y && npm i whatwg-url@15.1.0)
node docs/backlog/epics/isolate-guest-web-api/reference/sources-native/idna-url-host.cjs /tmp/IdnaTestV2.txt /tmp/w
```

`new URL('http://' + h + '/').hostname` over every IdnaTestV2 17.0.0 source, Node v24.16.0 (ada
3.4.4, Unicode 17.0) vs whatwg-url 15.1.0 (tr46 6.0.0): 308 of 6 357 non-ASCII/`xn--` sources
differ, all Bidi (`àא`: Node `xn--0ca24w`, whatwg-url throws as the URL spec's CheckBidi demands;
`results-idna-url-host.txt`). WPT `urltestdata.json`'s 0/886 does not cover them. So whatwg-url's
host step is not Node's: the guest `URL` needs Node's IDNA — a port of `ada::idna` from Node's
pinned `deps/ada/ada.cpp` (implementation thread's estimate: tables 230 KB raw, 82–97 KB gzip;
109 KB / 53 KB gzip with NFC from `String.prototype.normalize` if the isolate's ICU is Unicode 17,
not verified here) bound into whatwg-url's domain-to-ASCII step; tr46 is then not needed.
