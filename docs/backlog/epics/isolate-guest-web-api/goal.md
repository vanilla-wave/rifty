---
kind: epic
status: draft
title: Isolate guest Web API — Node 24's URL, Blob and ES module files in the isolate guest
created: 2026-11-24
value: A guest program in `runCode` or a sandbox `exec` that uses `URL`/`URLSearchParams`, `Blob`/`File`, the `node:` members built on them, or ES module files gets what `node` gives over the same files, and every Web API the guest still lacks fails with its named gap, never a leaked internal name or a wrong value.
user_story: As a Node service running model-written document generators in an isolate-host sandbox, I want `pptx.write()`'s `Blob`, exceljs reading back its workbook, `url.pathToFileURL` and an `.mjs` entry importing an ESM-only package to behave as in `node`, but today each stops at `NotImplementedError('isolate-host.<api>')` or a leaked `URLConstructor is not a constructor`, and `url.resolve` returns a wrong value
---

## Outcome

<!-- Draft. Scope = the recommended answer (a) to map.md question 1 («URL, Blob, ESM», the
user's words); answer (b) adds structuredClone, web streams, AbortController/AbortSignal,
Event/EventTarget/CustomEvent and their invariant rows. -->

The isolate guest (`runCode` and sandbox `exec`, ADR-0557/0568) gains Node 24's `URL`/
`URLSearchParams` and `Blob`/`File` with their static members, and the `node:` members that are
the same objects (`url.URL`, `url.URLSearchParams`, `buffer.Blob`, `buffer.File`). They behave as
Node v24.16.0's — proven against live Node, never approximated. The runtime's own uses of them
(`pathToFileURL`/`fileURLToPath`, `import()` by `file:` URL, `createRequire('file:…')`, `fs` with
a `URL` path) and `fs.createReadStream` give Node's result. ES module files load as in
`node <path>`: `.mjs`, `"type": "module"`, a typeless `.js` with ESM syntax, `import`/`import()`,
top-level await, `import.meta`, `require(esm)` with Node 24's default (the `--no-require-module`
deviation of PR #440 leaves). Node's legacy `url.parse`/`resolve`/`format` and `querystring` give
Node's results on every host. A Web API still outside the guest fails with its named gap from the
global, from a module export and from every runtime-internal use. The implementations run inside
the guest isolate under its limits.

## User scenario

<!-- Recommended answer (a) to map.md question 2: the consumer's own generators
(docs/backlog/distribution/reference/isolate-library-probe/gen/) plus the ESM entry the user named. -->

In an isolate-host sandbox whose `/workspace/node_modules` holds pptxgenjs 4.0.1, docx 9.15.3,
exceljs 4.4.0 and nanoid 5 (ESM-only), each file runs as `sandbox.exec(<file>)` and as
`node <file>` over the same files:

1. `pptx.cjs`: `await pptx.write()` returns a `Blob`; `Buffer.from(await blob.arrayBuffer())` is
   written to `deck.pptx`.
2. `docx.cjs`: `Packer.toBlob(doc)` → `report.docx` the same way.
3. `xlsx.cjs` writes `book.xlsx`; on the next run — "fix sheet 1" — `workbook.xlsx.readFile`
   (an `fs.createReadStream` under it) reads it back, edits a cell and writes it again.
4. `main.mjs` imports `nanoid` and a CommonJS module, and builds paths with
   `new URL('./out/', import.meta.url)` and `fileURLToPath`.
5. Every run gives the stdout, stderr, exit code and files `node` gives (document timestamps
   masked as the library probe does).

## Invariants

<!-- Draft until map.md questions 1–5 are answered. False on main 1c00c6292, Node v24.16.0
(probes in reference/): `URL`, `Blob`, `File` are ceiling throwers (web-shim.ts CEILING_GLOBALS);
`url.URL`, `url.URLSearchParams`, `buffer.Blob`, `buffer.File` are `undefined` (enumerate/
class a1); the captured-at-load table (runtime-js/isolate-web-globals-captured-at-load):
`pathToFileURL` → `URLConstructor is not a constructor`; `fs.createReadStream` →
`isolate-host.ReadableStream`; `pptx.write()` → `blob is not supported by this platform`
(library probe); `main.mjs` → `NotImplementedError('isolate-host.esm')` (seam-esm/);
`url.resolve('https://example.com/a','b')` → `'b'`, 1 037 of 1 313 Node url-test calls differ in
the guest (url-legacy/). -->

- I1. `URL`, `URLSearchParams`, `Blob`, `File` and their static members behave as Node v24.16.0's
  in the guest on fixed external corpora: WPT `urltestdata.json`/`setters_tests.json` as vendored
  by Node v24.16.0, Node's own `test-whatwg-url-*`, `test-blob*`, `test-file*` calls with Node's
  recorded results, and the vendored WPT `FileAPI` blob subset if Node vendors one (unverified) —
  0 differences in results, thrown `name`/`code`/`message`, prototype chains and descriptors.
- I2. Same objects: `url.URL`, `url.URLSearchParams`, `buffer.Blob`, `buffer.File` are `===` the
  guest's globals in a file run and in `runCode`; a Web API export that stays outside the guest
  (`stream/web.*`, `crypto.subtle`, …) is exported as its named thrower, never `undefined`.
- I3. Runtime-internal uses give Node's result: `url.pathToFileURL`/`fileURLToPath`, `import()` by
  `file:` URL, `createRequire('file:…')`, `fs.*` with a `URL` path, `fs.createReadStream` reads;
  for a Web API still outside the guest, its named gap — never a leaked internal name, an
  `undefined`, or a wrong value.
- I4. ES module files run as `node <path>`: stdout, stderr, exit code and files of `.mjs`,
  `"type": "module"`, typeless ESM `.js`, `import`/`import()` between ESM and CommonJS, top-level
  await, `import.meta.url`/`dirname`/`filename`/`resolve`, JSON with `with { type: 'json' }`,
  `require(esm)` with `process.features.require_module === true`, an ESM-only package (nanoid 5);
  diagnostic text differences are direction F's, pinned ⚠️.
- I5. Node's legacy `url.parse`/`resolve`/`resolveObject`/`format` and `querystring` give Node's
  results on every host, the guest included, with no global `URL` read.
- I6. The user scenario (§User scenario) passes as executable cases against live `node`.

## Challenge

challenge: 2026-11-24 — 12 problems (4 value/cheaper-route, 8 advisory) + 1 omitted user choice —
fresh read-only critic over the user's ratification, the manager's hand-off, the four questions
asked, goal/map/seeded drafts and the five probes. Verified; dispositions:

1. Q2 offered an agent-invented file as «the consumer's scenario» (consumer: CommonJS only, four
   libraries) and omitted the consumer's own generators — Q2 re-asked 2026-11-24 with them;
   §User scenario rewritten to them plus the user's ESM.
2. Q1's recommended (b) had no consumer evidence (no ceiling Web API breaks a measured write
   route; §6 accepts «реализован … или явно указан в compat с обходом»; `fs.createReadStream` can
   be fixed without the web global) — recommendation changed to (a), re-asked.
3. (b)'s `structuredClone` has no measured Node-faithful route — stated in the re-asked Q1.
4. Q3 misstated: lazy install is observable (Node's globals are data properties); the ADR-0541
   precedent is browser bundle growth, not per-isolate cost; no total was given — re-asked with
   (a) ≈ +1–3 ms, (b) ≥ +9 ms, the template-scale 601 ms warm `exec`; agent fog «lazy install»
   dropped from map.md.
5. url-legacy unit ready with challenge pending, eager tr46 — fixed in that item (its own
   Challenge record).
6. tr46 pin 5.1.1 vs whatwg-url 15.1.0's ^6.0.0 — one pin, 6.0.0 (40/40 vs Node).
7. Shared substrate without owner (Node-source generator, `primordials`/`ERR_*`/validators
   binding) — map.md names the url-legacy ADR as its first owner.
8. Blob seeded though `Blob.stream()` depends on Q1 — the Blob item states the stream member's
   outcome per answer.
9. I1 self-certified case lists — I1 pinned to Node-vendored WPT and Node's own tests.
10. I2 covered `sys.*` and `perf_hooks.Performance*` — I2 narrowed to the in-scope exports.
11. I3's invalid-`fs`-path code is `runtime-js/fs-path-invalid-arg-type`'s (every host) — removed
    from I3, listed in map.md Out of scope.
12. I7 was a duty, not a falsifiable invariant — moved to Decisions.
- Omitted choice, bundle size and per-isolate heap — folded into the re-asked Q3.

## Decisions

- 2026-11-24 — user (manager thread `cf2ae711`, asked «Web API в isolate (`URL`, `Blob`, ESM) —
  открыть целью?»): «запускай». Set, order, sources and tier are not the user's words.
- 2026-11-24 — agent, probe `reference/seam-esm`: the seam is load order — a global with a real
  implementation is installed before the runtime loads and leaves `CEILING_GLOBALS`; a name that
  stays a ceiling is installed as its thrower before the runtime too (runtime-js reads
  `crypto.subtle` and `MessageChannel` lazily). Measured: with `URL` first, every `URL` row of the
  captured-at-load table equals Node with no runtime change.
- 2026-11-24 — agent, probe `reference/sources-native`: `URL` parser whatwg-url 15.1.0 (0/886 WPT,
  0/278 setters vs Node; tr46 6.0.0 evaluated on the first non-`file:` parse) under Node's
  `lib/internal/url.js` wrapper; `URLSearchParams`, `Blob`/`File` (over a JS byte store) generated
  from pinned Node v24.16.0 sources (ADR-0541 pattern). Each needs an ADR (semantic copy).
- 2026-11-24 — cost is measured per unit (warm `runCode` median, guest bundle bytes) and recorded
  in the unit's ADR and the host README; whether growth is bounded is map.md question 3.
- rejected route: npm polyfills (core-js `URL`: 51 WPT differ; `formdata-node` Blob: 9/19;
  for answer (b): `web-streams-polyfill` 4.5.1 + `event-target-shim` 6.0.2 +
  `abortcontroller-polyfill` 1.7.8: 41/86, `@ungap/structured-clone`: 13/33) — violates I1.
- rejected route: a bridge to the host Node (ada `URL`, V8 serializer via `ivm.Callback`) — no
  faster (~10 µs a call, as the JS parser), the guest object graph materialized in the child
  outside the isolate's memory limit, a new host function over hostile input amends ADR-0557 §6 —
  violates Outcome «inside the guest isolate under its limits».
- rejected route: a use-time forwarder over `globalThis[name]` (`loadedGlobal`, PR #440 round 2)
  — `new.target` gave instances the forwarder's prototype, internals depended on what the guest
  put in `globalThis` — violates I3.
- rejected route: lazy install of a global on first access — Node's are data properties, an
  accessor is observable (`Object.getOwnPropertyDescriptor`) — violates I1.
- rejected route: a named gap for `url.parse`/`resolve` in the guest — Node's legacy API needs no
  `URL`; a throw for working behaviour (AGENTS.md §Fidelity), and the browser hosts' 904/1 313
  wrong results stay — violates I5.
