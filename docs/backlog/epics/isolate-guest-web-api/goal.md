---
kind: epic
status: draft
title: Isolate guest Web API — Node 24's URL, Blob, structuredClone, web streams, EventTarget/AbortController and ES module files in the isolate guest
created: 2026-11-24
value: A guest program in `runCode` or a sandbox `exec` that uses Node 24's Web API globals, the `node:url`/`buffer`/`stream/web` members built on them, or ES module files gets what `node` gives over the same files, and every Web API the guest still lacks fails with its named gap, never a leaked internal name or a wrong value.
user_story: As a Node service running model-written code in an isolate-host sandbox, I want `new URL`, `structuredClone`, `AbortSignal.timeout`, a `Blob`, a file read stream and `import` of an ESM-only package to behave as in `node`, but today each is `NotImplementedError('isolate-host.<api>')`, the runtime's own uses of them leak `URLConstructor is not a constructor`, and `url.resolve` returns a wrong value
---

## Outcome

The isolate guest (`runCode` and sandbox `exec`, ADR-0557/0568) gains real Node 24 Web APIs:
`URL`/`URLSearchParams`, `Blob`/`File`, `structuredClone`, web streams (with
`TextEncoderStream`/`TextDecoderStream`), `Event`/`EventTarget`/`CustomEvent`,
`AbortController`/`AbortSignal`, their static members, and the `node:` module members that are
the same objects (`url.URL`, `buffer.Blob`, `stream/web.*`, `events.EventTarget`, …). They behave
as Node v24.16.0's: proven against live Node, never approximated. The runtime's own uses of them
(`pathToFileURL`, `import()` by `file:` URL, `createRequire('file:…')`, `fs` with a `URL` path,
`fs.createReadStream`) give Node's result. ES module files load as in `node <path>`: `.mjs`,
`"type": "module"`, a typeless `.js` with ESM syntax, `import`/`import()`, top-level await,
`import.meta`, `require(esm)` with Node 24's default (the `--no-require-module` deviation of
PR #440 leaves). Node's legacy `url.parse`/`resolve`/`format` and `querystring` give Node's
results on every host. A Web API still outside the guest fails with its named gap from the
global, from a module export and from every runtime-internal use. The implementations run inside
the guest isolate under its limits. Cost (warm call, bundle size) is measured and documented.

Scope above is the recommended answer to the open user question on the API set (map.md); the
user's answer fixes it.

## User scenario

<!-- Recommended form; owner: user question 2 in map.md decides whose scenario counts. -->

A model writes `/workspace/main.mjs` for an isolate-host sandbox whose `node_modules` holds
exceljs 4.4.0, pptxgenjs 4.0.1 and nanoid 5 (ESM-only):

1. `main.mjs` imports `nanoid` and `exceljs` (CommonJS) and builds an output path with
   `new URL('./out/', import.meta.url)` and `fileURLToPath`.
2. It deep-copies its config with `structuredClone`, reports progress through an `EventTarget`,
   and bounds a step with `AbortSignal.timeout`.
3. It writes `book.xlsx`, then — the next turn, "fix sheet 1" — reads it back with
   `workbook.xlsx.readFile` (an `fs.createReadStream` under it), edits a cell and writes it again.
4. It writes a deck with `pptx.write()` (a `Blob`), turns it into bytes with
   `await blob.arrayBuffer()` and writes `deck.pptx`.
5. It resolves a link with `url.resolve` and parses one with `url.parse`.
6. `sandbox.exec('main.mjs')` gives the stdout, stderr, exit code and files `node main.mjs` gives
   over the same files (timestamps inside documents masked).

## Invariants

<!-- Draft until the user answers map.md questions 1–4. False on main 1c00c6292, Node v24.16.0
(probes in reference/): every in-scope global is a ceiling thrower (web-shim.ts CEILING_GLOBALS);
31 of Node's 49 builtin exports that are `===` a global are not in the guest (enumerate/);
the captured-at-load table (runtime-js/isolate-web-globals-captured-at-load) — `pathToFileURL`
→ `URLConstructor is not a constructor`, `fs.createReadStream` → `isolate-host.ReadableStream`;
`main.mjs` → `NotImplementedError('isolate-host.esm')` (seam-esm/); `url.resolve('https://
example.com/a','b')` → `'b'`, 1 037 of 1 313 Node url-test calls differ in the guest (url-legacy/). -->

- I1. Each in-scope global and its static members behave as Node v24.16.0's in the guest: 0
  differences on the differential suites — WPT `urltestdata.json`/`setters_tests.json` for `URL`,
  case lists grown per unit for the others (results, thrown `name`/`code`/`message`, prototype
  chains, property descriptors).
- I2. Same objects: every builtin-module export that is `===` a global in Node is `===` the guest's
  global, in a file run and in `runCode` (incl. `crypto.webcrypto.subtle === crypto.subtle ===
  globalThis.crypto.subtle`); a Web API still outside the guest is exported as its named thrower.
- I3. Runtime-internal uses give Node's result: `url.pathToFileURL`/`fileURLToPath`, `import()` by
  `file:` URL, `createRequire('file:…')`, `fs.*` with a `URL` path or an invalid one
  (`ERR_INVALID_ARG_TYPE`), `fs.createReadStream` reads, `Readable.toWeb`/`fromWeb`; for a Web API
  still outside the guest, its named gap — never a leaked internal name, an `undefined`, or a
  wrong value.
- I4. ES module files run as `node <path>`: stdout, stderr, exit code and files of `.mjs`,
  `"type": "module"`, typeless ESM `.js`, `import`/`import()` between ESM and CommonJS, top-level
  await, `import.meta.url`/`dirname`/`filename`/`resolve`, JSON with `with { type: 'json' }`,
  `require(esm)` with `process.features.require_module === true`, an ESM-only package; diagnostic
  text differences are direction F's, pinned ⚠️.
- I5. Node's legacy `url.parse`/`resolve`/`resolveObject`/`format` and `querystring` give Node's
  results on every host, the guest included, with no global `URL` read.
- I6. The user scenario (§User scenario) passes as one executable case against live `node`.
- I7. Cost recorded: warm `runCode` median and guest bundle size before/after each unit, in the
  host README and the unit's ADR (bound: map.md question 3).

## Challenge

challenge: pending — premise critic on the recommended direction (Node-sourced implementations
in the guest, seam by load order) runs with the user's answers at FIT step 6.

## Decisions

- 2026-11-24 — user (manager thread `cf2ae711`, asked «Web API в isolate (`URL`, `Blob`, ESM) —
  открыть целью?»): «запускай». Set, order, sources and tier are not the user's words.
- 2026-11-24 — agent, probe `reference/seam-esm`: the seam is load order — a global with a real
  implementation is installed before the runtime loads and leaves `CEILING_GLOBALS`; a name that
  stays a ceiling is installed as its thrower before the runtime too (runtime-js reads
  `crypto.subtle` and `MessageChannel` lazily). Measured: with `URL` first, every `URL` row of the
  captured-at-load table equals Node with no runtime change.
- 2026-11-24 — agent, probes `reference/sources-native`, `reference/sources-js`: sources per API —
  `URL` parser whatwg-url 15.1.0 (0/886 WPT, 0/278 setters vs Node; tr46 loaded on first non-`file:`
  parse) under Node's `lib/internal/url.js` wrapper; `URLSearchParams`, web streams, `EventTarget`/
  `Event`/`CustomEvent`, `AbortController`/`AbortSignal`, `DOMException`, `Blob`/`File` generated
  from pinned Node v24.16.0 sources (ADR-0541 pattern; `Blob` over a JS byte store);
  `structuredClone` own JS with V8 serializer semantics under Node's `js_transferable.js` wrapper,
  core-js's algorithm as reference. Each needs an ADR (semantic copy) before its unit.
- rejected route: npm polyfills (`web-streams-polyfill` 4.5.1 + `event-target-shim` 6.0.2 +
  `abortcontroller-polyfill` 1.7.8: 41/86 cases differ; core-js `URL`: 51 WPT differ;
  `@ungap/structured-clone`: 13/33; `formdata-node` Blob: 9/19) — violates I1.
- rejected route: a bridge to the host Node (ada `URL`, V8 serializer via `ivm.Callback`) — no
  faster (~10 µs a call, as the JS parser), the whole guest object graph is materialized in the
  child outside the isolate's memory limit, and a new host function over hostile input amends
  ADR-0557 §6 — violates Outcome «inside the guest isolate under its limits».
- rejected route: a use-time forwarder over `globalThis[name]` (`loadedGlobal`, PR #440 round 2)
  — `new.target` gave instances the forwarder's prototype, internals depended on what the guest
  put in `globalThis` — violates I3.
- rejected route: a named gap for `url.parse`/`resolve` in the guest — Node's legacy API needs no
  `URL`; a throw for working behaviour (AGENTS.md §Fidelity), and the browser hosts' 904/1 313
  wrong results stay — violates I5.
- `-e` ES modules (`runCode` with `import()`/ESM syntax) and `data:` imports are separate runtime-js
  work (seam-esm §3): scope is map.md question 5.
