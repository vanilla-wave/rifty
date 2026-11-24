# Map — isolate-guest-web-api

Probes (2026-11-24, `origin/main` 1c00c6292, Node v24.16.0): `reference/` — `sources-native`
(URL, Blob, structuredClone sources), `sources-js` (streams, EventTarget, Abort sources), `seam-esm`
(load-order seam, ESM), `enumerate` (builtin-export identity sweep, `catch` pass), `url-legacy`
(legacy `node:url`). Each README holds its command, results and «not verified».

## Items

1. `distribution/isolate-guest-web-api-acceptance` — draft — the acceptance carrier: goal §User
   scenario as one `it.fails` sandbox case against live `node main.mjs` (I6); its contract waits
   for questions 1–2.
2. `runtime-js/node-url-legacy-api-port` — **ready** — Node's legacy `url`/`querystring` generated
   from pinned Node sources on every host; ADR first (I5). Independent of the `URL` source; its
   generator and `tr46` pin are the first instance of the Node-source mechanism later units reuse.
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
   over a JS byte store; `Blob.stream()` needs web streams (I1, I2).
8. `distribution/isolate-host-fs-read-stream-needs-web-readablestream` — draft — `fs.createReadStream`
   reads; closes with the web-streams unit or a read path without the web global (I3).
9. `runtime-js/fs-stream-close-method-missing` — draft — exceljs `xlsx.readFile` (scenario step 3)
   after 8; a wall the carrier is expected to hit.

Not seeded until question 1 is answered: `structuredClone`, web streams (+ `TextEncoderStream`/
`TextDecoderStream`), `EventTarget`/`Event`/`CustomEvent`, `AbortController`/`AbortSignal`,
`DOMException` from Node (sources and costs: `reference/sources-native`, `reference/sources-js`).

## Open questions

- 1. API set: (a) URL/URLSearchParams + Blob/File + ES modules + internal uses; (b) (a) + the
  requirements' list (structuredClone, web streams, AbortController/AbortSignal, Event/EventTarget/
  CustomEvent); (c) (b) + everything without a host capability (fetch classes without `fetch`,
  MessageChannel/BroadcastChannel, URLPattern, `performance.mark`/`measure`) — owner: user —
  asked 2026-11-24, recommended (b).
- 2. Whose scenario closes the goal: the consumer's agent file (goal §User scenario) or a generic
  per-API corpus — owner: user — asked 2026-11-24, recommended the agent file with per-API parity
  as invariant proof.
- 3. Warm-call budget (today 13 ms): measured growth, no new limit (ADR-0541 precedent), or a hard
  bound with lazy install — owner: user — asked 2026-11-24; measured since: core-js `URL` first
  +2.5 ms (seam-esm), whatwg-url eager +3.8 / lazy tr46 +0.8 ms, Node's streams+events+abort eager
  +5.4 ms (sources-js), structuredClone/Blob own JS not measured.
- 4. Tier: `works` (recommended: computation inside the isolate, no new boundary) or `robust` —
  owner: user — asked 2026-11-24.
- 5. ES modules in `-e` (`runCode` with `import()` or ESM syntax: today `isolate-host.dynamic-import`/
  `node-eval-esm`; needs the file loader's `import()` rewrite and `-e` module detection,
  `runtime-js/node-cli-esm-eval-context`) — in this goal or the next — owner: user — asked 2026-11-24.
- Lazy install of the Node-sourced modules on first global access versus a trimmed `primordials`/
  `errors` subset — owner: agent — a timing probe inside the real guest bundle once question 3 is
  answered.
- `structuredClone` own JS: size, warm cost, agreement on the 33 cases — owner: agent — prototype
  in its unit (not measured: `sources-native` «not verified»).

## Out of scope

- `fetch`, `WebSocket`: network egress stays a named gap (ADR-0557 §6).
- `crypto.subtle`/`SubtleCrypto`/`CryptoKey`, `CompressionStream`/`DecompressionStream`: need a crypto
  or compression engine in the guest — their own goals.
- `data:` URL imports: rifty's gap on every host (`runtime-js/process-module-loader-surface`).
- Text of ESM diagnostics (stack line, file URL in frames, source header): direction F, pinned ⚠️.
- Browser hosts' Web globals (native there); browser-host `navigator` and browser-only globals
  (`runtime-js/browser-host-guest-navigator`, `runtime-js/guest-browser-only-globals`).
- `url.domainToASCII`/`domainToUnicode`/`urlToHttpOptions`, output-changing `url.format(URL, options)`:
  `runtime-js/node-url-legacy-format-and-helpers`.
