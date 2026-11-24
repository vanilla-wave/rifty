# Map — isolate-guest-web-api

Probes (2026-11-24, `origin/main` 1c00c6292, Node v24.16.0): `reference/` — `sources-native`
(URL, Blob, structuredClone sources), `sources-js` (streams, EventTarget, Abort sources), `seam-esm`
(load-order seam, ESM), `enumerate` (builtin-export identity sweep, `catch` pass); the legacy `node:url` probe moved to
branch `t3/node-url-legacy-port` (under `runtime-js/reference/` there). Each README holds its command, results and «not verified».

## Items

1. `distribution/isolate-guest-web-api-acceptance` — draft — the acceptance carrier: goal §User
   scenario as one `it.fails` sandbox case against live `node main.mjs` (I6); its contract waits
   for questions 1–2.
2. `runtime-js/node-url-legacy-api-port` — **in progress, branch `t3/node-url-legacy-port`**
   (contract and its probe live there, probe under `runtime-js/reference/` there) —
   Node's legacy `url`/`querystring` generated from pinned Node sources on every host (I5). Its ADR
   is the first owner of the shared Node-source mechanism (vendored pinned files, generator with edit
   anchors, drift check, the `primordials`/`ERR_*`/validators binding) and of the `tr46` 6.0.0 pin;
   later units (4, 7) extend it or supersede it by ADR. `epic:` returns when both branches meet main.
3. `runtime-js/isolate-web-globals-captured-at-load` — draft — the seam: real globals and the
   remaining ceiling throwers both installed before the runtime loads; `crypto.subtle` and
   `MessageChannel` read lazily in runtime-js; the identity sweep as a test (I2, I3).
4. `runtime-js/isolate-guest-url` — draft — `URL`/`URLSearchParams` (whatwg-url 15.1.0 parser,
   Node's wrapper; tr46 shared with 2) (I1, I3).
5. `runtime-js/isolate-esm-files` — draft — the guest's ES module loader once `URL` exists
   (`declareNoEsmLoader` leaves, `require(esm)` Node's default); needs 4 and
   `runtime-js/esm-import-binding-asi` (I4).
6. `runtime-js/esm-import-binding-asi` — draft — the ESM transform's `(ns().x)` binding continues
   a previous line without `;` (nanoid's stop; every host by source) (I4).
7. `runtime-js/isolate-guest-blob-file` — draft — `Blob`/`File` from Node's `blob.js`/`file.js`
   over a JS byte store; `Blob.stream()` is Node's under question 1 (b), the `ReadableStream`
   named gap under (a) (I1, I2).
8. `distribution/isolate-host-fs-read-stream-needs-web-readablestream` — draft — `fs.createReadStream`
   reads; under question 1 (a) a read path without the web global (Node's `ReadStream` uses none),
   under (b) the web-streams unit (I3).
9. `runtime-js/fs-stream-close-method-missing` — draft — exceljs `xlsx.readFile` (scenario step 3)
   after 8; a wall the carrier is expected to hit.

Not seeded until question 1 is answered (seeded only under (b)): `structuredClone` (no measured
Node-faithful route yet), web streams (+ `TextEncoderStream`/`TextDecoderStream`),
`EventTarget`/`Event`/`CustomEvent`, `AbortController`/`AbortSignal`, `DOMException` from Node
(sources and costs: `reference/sources-native`, `reference/sources-js`).

## Open questions

- 1. API set: (a) URL/URLSearchParams + Blob/File + ES modules + internal uses (the user's
  words); (b) (a) + structuredClone, web streams, AbortController/AbortSignal,
  Event/EventTarget/CustomEvent; (c) (b) + everything without a host capability — owner: user —
  asked 2026-11-24, re-asked after the critic, recommended (a).
- 2. Whose scenario closes the goal: the consumer's own generators + the user's ESM entry (goal
  §User scenario) or a generic per-API corpus — owner: user — re-asked 2026-11-24, recommended the
  consumer's generators.
- 3. Cost (warm call, guest bundle bytes, per-isolate heap): measured growth with no new limit, or
  a hard bound — owner: user — re-asked 2026-11-24 with (a) ≈ +1–3 ms, (b) ≥ +9 ms on a 13 ms
  empty `runCode` (601 ms warm `exec` at template scale), bundle +0.3 / +0.9 MB on 7.1 MB, heap
  not measured; recommended measured growth.
- 3b. IDN hostnames in the legacy `url.parse` (`runtime-js/node-url-legacy-api-port`): (a) `tr46`
  on every host (+241 KB min / 62 KB gzip per bundle with `node:url`); (b) non-ASCII/`xn--` labels a
  named gap, no dependency (a throw where browser hosts work today); (c) the host's own `URL` where
  one exists (browser hosts), a named gap where none (the isolate until this goal's `URL`) — owner:
  user — asked 2026-11-24; (c) added by the manager 2026-11-24, its agreement of Chromium's host
  parser with Node's `toASCII` measured first by the implementation thread (the url-legacy probe
  saw IPv4 normalisation, percent-decoding and Bidi checks the native parser applies and ada's
  `to_ascii` does not); recommendation (c) if it matches, else (a).
- IDNA table in the guest bundle: any real `URL` in the isolate needs one (whatwg-url 15.1.0 →
  `tr46` 6.0.0, ~241 KB) — its cost is this goal's question 3, not the url-legacy unit's.
- 4. Tier: `works` (recommended: computation inside the isolate, no new boundary) or `robust` —
  owner: user — asked 2026-11-24.
- 5. ES modules in `-e` (`runCode` with `import()` or ESM syntax: today `isolate-host.dynamic-import`/
  `node-eval-esm`; needs the file loader's `import()` rewrite and `-e` module detection,
  `runtime-js/node-cli-esm-eval-context`) — in this goal or the next — owner: user — asked
  2026-11-24, recommended the next.
- `structuredClone` own JS: size, warm cost, agreement on the 33 cases — owner: agent — prototype
  before its unit is seeded, only under question 1 (b).

## Out of scope

- `fetch`, `WebSocket`: network egress stays a named gap (ADR-0557 §6).
- `crypto.subtle`/`SubtleCrypto`/`CryptoKey`, `CompressionStream`/`DecompressionStream`: need a crypto
  or compression engine in the guest — their own goals.
- `data:` URL imports: rifty's gap on every host (`runtime-js/process-module-loader-surface`).
- `fs.*` with an invalid path: Node's `ERR_INVALID_ARG_TYPE` is `runtime-js/fs-path-invalid-arg-type`'s
  (every host); with a real `URL` the guest gives the every-host error.
- Text of ESM diagnostics (stack line, file URL in frames, source header): direction F, pinned ⚠️.
- Browser hosts' Web globals (native there); browser-host `navigator` and browser-only globals
  (`runtime-js/browser-host-guest-navigator`, `runtime-js/guest-browser-only-globals`).
- `url.domainToASCII`/`domainToUnicode`/`urlToHttpOptions`, output-changing `url.format(URL, options)`:
  `runtime-js/node-url-legacy-format-and-helpers`.
