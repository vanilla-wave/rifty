---
area: runtime-js
status: ready
title: The isolate guest's `Blob` and `File` are Node v24.16.0's own classes, and `buffer.Blob`/`buffer.File` are the same objects
created: 2026-11-24
why: both are ceiling throwers in the isolate guest and `require('buffer').Blob` is `undefined` (captured at load), so `pptx.write()` and `docx Packer.toBlob` fail where Node returns a `Blob`
epic: isolate-guest-web-api
sources: [docs/backlog/epics/isolate-guest-web-api/reference/today/README.md, docs/backlog/epics/isolate-guest-web-api/reference/sources-native/README.md, docs/backlog/epics/isolate-guest-web-api/reference/wpt/README.md, docs/backlog/distribution/reference/isolate-library-probe/README.md]
code: [packages/isolate-guest/src/guest/web-shim.ts, packages/isolate-guest/src/guest/entry.ts, packages/runtime-js/src/builtins/buffer.ts]
---

## Context

Host: the isolate guest only (`runCode`, sandbox `exec`); browser hosts keep their native classes.

Sources (`reference/sources-native`, Node v24.16.0): `lib/internal/blob.js` (14 KB) and
`lib/internal/file.js` (3 KB) are JS over a C++ byte store, `internalBinding('blob')`
(`createBlob`, `concat`, `getReader`, blob-URL store). `blob.js` also requires
`internal/util/inspect`, `timers`, `internal/process/task_queues`, `internal/encoding` and
`internal/url`, so the classes load with the runtime, not before it. No npm candidate is Node's:
`formdata-node` 6.0.3 differs on 9/19 cases (`text()` needs `ReadableStream`, no `endings`/`bytes()`,
type not lower-cased), `blob-polyfill` 13/19, `fetch-blob` 4.0.0 does not bundle as an IIFE.
Node-only behaviour to keep: `endings: 'native'` leaves a lone `\r`.

Today — pins (`reference/today/results.txt`, main bc3412420 product code; `exec` and `runCode`
equal):

| call | Node v24.16.0 | isolate guest |
|---|---|---|
| global `Blob`/`File` descriptor | data, function, writable, non-enumerable, configurable | same |
| `new Blob(['a'])` | a `Blob` | `NotImplementedError: … isolate-host.Blob (…)` |
| `new Blob(['ab', new Uint8Array([99])], {type: 'Text/Plain'})` `.size`/`.type` | `3 text/plain` | the same `NotImplementedError` |
| `new Blob(['h', 'é']).text()` | `hé` | the same |
| `new Blob(['abc'])` `.arrayBuffer()` / `.bytes()` / `.slice(1, 2).text()` | `ArrayBuffer(3)` / `Uint8Array[97,98,99]` / `b` | the same |
| `new Blob(['abc']).stream()` | a `ReadableStream` | the same |
| `new File(['x'], 'n', {lastModified: 5})` | `n 5 1` | `NotImplementedError: … isolate-host.File (…)` |
| `typeof buffer.Blob` / `buffer.File` | `function` | `undefined` (`buffer.ts:42-43` reads them at load) |
| `buffer.Blob === Blob`, `buffer.File === File` | `true` | `false` |
| `new buffer.Blob(['a']).size` | `1` | `TypeError: buffer.Blob is not a constructor` |
| `({}) instanceof Blob` | `false` | same |
| `({}) instanceof buffer.Blob` | `false` | `TypeError: Right-hand side of 'instanceof' is not an object` |
| `typeof buffer.resolveObjectURL` | `function` | same |

## User scenario

Goal §User scenario steps 1–2: `pptx.write()` and `Packer.toBlob(doc)` return a `Blob` whose bytes
are written as the document (carrier `distribution/isolate-guest-web-api-acceptance`).

## Acceptance

1. WPT `FileAPI/blob` and `FileAPI/file` (Node v24.16.0's vendored copy, sha256-pinned) through the
   shared harness of row 10: every subtest gives the guest the result live Node gives it, except,
   listed in the test: `Blob-stream.any.js` (`ReadableStream`, `garbageCollect`), the
   `MessageChannel` subtests of `Blob-constructor.any.js` (lines 389–396), and every
   `.html`/`.window.js`/`.worker.js` file (Node skips them too) → I1
2. Every row of §Context's pin table equals Node in `exec` and `runCode`, except the `stream()` row,
   which is Acceptance 5 → I1, I4
3. Node behaviours beyond WPT, against live Node: `endings: 'native'` with a lone `\r`, type
   lower-casing and invalid-type → `''`, `bytes()`, `slice` with negative and out-of-range bounds,
   `File` default `lastModified` (`Date.now()` at construction), `name` and part coercion
   (`Symbol` → Node's `TypeError`), `Symbol.toStringTag`, `Object.getOwnPropertyNames` of both
   prototypes, constructor `length` — 0 differences → I1
4. `require('buffer').Blob === Blob` and `.File === File` in a file run and in `runCode`;
   `({}) instanceof require('buffer').Blob` is `false`; the runtime's `buffer` exports are bound
   when the classes are installed, before guest code → I4
5. `blob.stream()` throws `NotImplementedError('isolate-host.ReadableStream')`; `URL.createObjectURL`
   stays the `URL` ceiling and `buffer.resolveObjectURL` behaves as today (no blob URL is ever
   created) → I1
6. Mechanism: Node's `lib/internal/blob.js` and `lib/internal/file.js` vendored at v24.16.0
   (sha256-pinned, MIT notice), generated with checked edit anchors and a drift check (ADR-0541
   pattern); `internalBinding('blob')` bound to a JS byte store (immutable parts, `slice` without
   copying, `getReader` chunks as Node's), `internal/url`'s blob-URL use bound to the named gap;
   an ADR (semantic copy, byte store) comes first → I1
7. Cost: `dist/guest.js` bytes and gzip and the warm `runCode('1')` median (40 calls, base and
   change alternating) before and after, recorded in the ADR and the isolate-host README; no bound
   (goal Decisions) → ADR-0563
8. Compat `docs/public/compat/isolate-host.md`: `Blob`/`File` leave the ceiling row and the row
   "Web globals absent when the runtime loads"; a `Blob`/`File` row ✅ names the `stream()` gap ❌ →
   I1, I4
9. The carrier's `docx-toblob.cjs` case passes (plain `it`); `pptx-write.cjs` passes or its new
   first stop is recorded in the carrier as a wall (a backlog item), never left as `blob is not
   supported by this platform` → I5
10. One shared WPT harness, owned here (first consumer; `distribution/isolate-guest-textdecoder-legacy-encodings`
    and `node-streams-as-in-node` unit 7 reuse it): WPT's own `resources/testharness.js` plus a shim
    as Node's `test/common/wpt/worker.js` sets up (`self`, `GLOBAL`, `location`, `META_TITLE`,
    `META: script=` dependencies), concatenated into one CommonJS file run as `sandbox.exec` and as
    `node`; per-subtest results (name, status, message) of the guest compared with live Node's
    (probe `epics/isolate-guest-web-api/reference/wpt`: 14 files, a 26-line shim, 60–200 ms a file
    in the guest) → I1
11. `stream/consumers.blob(readable)` gives Node's `Blob` (size, type `''`, bytes) in the guest;
    `fs.openAsBlob` becomes reachable in the guest with rifty's eager read — declared ⚠️ in the compat
    row (after an overwrite Node's `text()` rejects `NotReadableError`, a clone throws
    `TypeError`; `runtime-js/fs-open-as-blob-eager-read`) → I1

## Parity cases

- WPT `FileAPI/blob`, `FileAPI/file` per subtest against live Node, exclusions listed — RED (probe:
  `Blob-slice` Node 144 pass / 6 fail, guest 28 fail at the ceiling) → I1
- `await require('stream/consumers').blob(Readable.from(['ab', 'c']))` → `Blob` size 3, `text()`
  `abc` — RED → I1
- the pin table's 13 rows — RED except the three equal today (descriptor, `({}) instanceof Blob`,
  `typeof buffer.resolveObjectURL`), which are guards → I1, I4
- `new Blob(['a\rb'], {endings: 'native'}).text()`, `new Blob([], {type: 'TEXT/Plain'}).type`,
  `new Blob([], {type: 'aé'}).type`, `new Blob(['abc']).slice(-2).text()`,
  `new Blob(['abc']).slice(5, 1).size`, `new File([], Symbol())` (Node's `TypeError`),
  `typeof new File([], 'n').lastModified` — RED → I1
- `({}) instanceof require('buffer').Blob` → `false` — RED → I4
- `new Blob(['a']).stream()` → `NotImplementedError('isolate-host.ReadableStream')` — RED → I1

## Reference contract

Node v24.16.0 `lib/internal/blob.js`, `lib/internal/file.js` (and the `internal/*` they require,
bound to the guest's runtime), `test/wpt/test-blob.js`, `test-file.js`, `test/wpt/status/FileAPI/`.
Mechanism: vendored upstream text, generator with edit anchors, drift check; oracle live Node
v24.16.0. A Node re-pin regenerates and reruns the suites.

## Out of scope

- `Blob.prototype.stream()`: `NotImplementedError('isolate-host.ReadableStream')`, compat ❌
  (web streams: `distribution/isolate-guest-web-streams`).
- `fs.openAsBlob`'s lazy-read semantics: ⚠️ (Acceptance 11, `runtime-js/fs-open-as-blob-eager-read`).
- Blob URLs (`URL.createObjectURL`, a live `resolveObjectURL`): the `URL` ceiling, compat ❌ (goal
  `isolate-guest-modern-code`).
- `structuredClone`/`postMessage` of a `Blob`: those ceilings, compat ❌.
- Browser hosts.

## Decisions

- 2026-11-25 — the classes load with the runtime (their `internal/*` needs), and become globals before
  guest code; `buffer`'s exports bound then (goal Decisions).
- 2026-11-25 — manager (PR #443 review S4): one WPT harness, owned here; compared with live Node per
  subtest (Node's status files lag, `reference/wpt`).
- 2026-11-25 — a JS byte store, not a host bridge (goal: inside the isolate under its limits).
- rejected route: npm `Blob` polyfills — 9/19 and 13/19 cases differ — violates I1.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
