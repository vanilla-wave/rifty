# ADR 0578: Isolate guest Blob and File are Node v24.16.0's blob.js and file.js over a JS byte store

Status: Accepted
Date: 2026-11

> TL;DR: in the isolate guest, `Blob`/`File` (and `buffer.Blob`/`buffer.File`, the same objects)
> are Node v24.16.0's `lib/internal/blob.js` and `file.js`, with the `webidl.js` they convert
> through, vendored, generated unedited and drift-checked (ADR-0574 pattern). Node's byte store is
> C++ (`internalBinding('blob')`); here it is a JS store, the one own part. `stream()` stays the
> `ReadableStream` gap. Amends ADR-0557 §5: `Blob`, `File` leave the closed ceiling list.

## Context

Unit `runtime-js/isolate-guest-blob-file` of goal `isolate-guest-web-api` (deleted on done; its
decisions are here, in compat and CHANGELOG). In the guest `new Blob` was a ceiling thrower and
`require('buffer').Blob` `undefined` (`buffer.ts` reads the global at load), so pptxgenjs
`write()` and docx `Packer.toBlob()` failed where Node returns a `Blob`. Probe
`reference/sources-native` of the goal: no npm `Blob` is Node's (`formdata-node` 6.0.3 differs on
9/19 cases, `blob-polyfill` 13/19, `fetch-blob` 4.0.0 does not build as the guest's IIFE).

Node's `blob.js` (14 KB) and `file.js` (3 KB) are JS: WebIDL conversion, `endings`, type rules,
`slice` bounds, `text`/`arrayBuffer`/`bytes`, errors. Native: `internalBinding('blob')`
(`createBlob`, `concat`, handle `slice`/`getReader`, blob-URL and file-backed blob stores).
They also require `internal/util/inspect`, `timers`, `task_queues`, `internal/encoding`,
`internal/url`: they load with the runtime, not before it.

## Decision

1. Vendor Node v24.16.0 `lib/internal/webidl.js`, `blob.js`, `file.js` and Node's `LICENSE` under
   `tools/publishing/node-blob/vendor/`, pinned by sha256. `generate-node-blob.mjs` checks each
   file's exact `require`/`internalBinding` ids and its `primordials` names against the lists the
   bindings provide (an id outside them fails at load, `bound()`) and writes `packages/isolate-guest/src/guest/node-blob/generated/` (identifiers kept: V8 names a
   class by its source name in `Class constructor Blob cannot be invoked without 'new'`);
   `check:node-blob-drift` checks the committed output; the third-party manifest records it. No
   upstream line is edited: every input is a binding.
2. Byte store (`byte-store.ts`), the one own mechanism, Node's `DataQueue` shape measured against
   live Node: a handle is a list of entries — a part (`blob.js`'s own copy, whose buffer the store
   takes over: detached, as Node's C++ does; a `SharedArrayBuffer`-backed one, growable or not,
   copied) or a source blob's handle,
   kept nested (no flattening: 150 000 parts or 24 doublings `new Blob([b, b])` cost what they cost
   in Node); `slice` (iterative: as deep as the nesting) keeps views and nested slices, no copy, starting at the first entry ending at
   or after its start. A reader pulls synchronously: a part gives a copy of its bytes, the end of an
   entry a read without bytes unless it ends its queue (`arrayBuffer()` of `p` parts settles after
   `2p − 1` reads; an empty nested blob is one read). Intrinsics captured at bundle load; the parts
   never reach guest code. `getDataObject` (blob URLs) and `createBlobFromFilePath` (file-backed
   blobs) are named gaps no exported path reaches.
3. Bindings (`bindings.ts`): `primordials` captured at bundle load (before guest code); Node's
   `makeNodeErrorWithCode` shape (own `code`, `constructor` → the base, `kIsNodeError`, coded
   `toString`, Node's stack header, own-key order by text kind, `HideStackFramesError` for the
   validator) with the `E()` texts of `ERR_BUFFER_TOO_LARGE`,
   `ERR_INVALID_ARG_TYPE`, `ERR_INVALID_ARG_VALUE`, `ERR_INVALID_STATE`, `ERR_INVALID_THIS`,
   `ERR_MISSING_ARGS`; `validateDictionary`; `PromiseWithResolvers`, `ArrayPrototypeToSorted`,
   `StringPrototypeToWellFormed` as ES2022 equivalents (the shipped-bundle floor, ADR-0469); V8 brand checks for `internal/util/types` (captured
   getters, no `Symbol.toStringTag` read); `kMaxLength` 2^53 − 1; the guest's UTF-8 codec,
   rifty's `inspect`, the guest's `DOMException`, `queueMicrotask` and rifty's `setImmediate`;
   `markTransferMode` a no-op and `kClone`/`kDeserialize` Node's symbol descriptions
   (`structuredClone`/`postMessage` are ceilings here); `internal/url`'s `URL` the `URL` ceiling;
   `internal/webstreams/readablestream` → `NotImplementedError('isolate-host.ReadableStream')`.
4. Install (`entry.ts` `setUp`): after the runtime loaded and the ceilings are installed, before
   guest code — `Blob`/`File` as data globals (`w1e0c1`, as Node's), and the runtime's `buffer`
   module object's `Blob`/`File` set to the same classes. Browser hosts are untouched (native
   classes). rifty's `stream/consumers.blob` and `fs.openAsBlob` read the global at call time.
5. Not Node (declared, compat `isolate-host.md`): `stream()`; blob URLs (`URL.createObjectURL`
   stays the `URL` ceiling's static-member gap, `buffer.resolveObjectURL` stays rifty's
   `NotImplementedError`); `structuredClone` of a `Blob`; rifty's `fs.openAsBlob` reads eagerly
   into a plain `Blob` (type lower-cased, an overwrite leaves it readable —
   `runtime-js/fs-open-as-blob-eager-read`); `util.inspect(blob)` follows rifty's inspect, which
   reads no `inspect.custom` hook (compat `util.inspect.custom` row), and error messages quote a
   value through it (a string over ~120 characters cut earlier, a lone surrogate unescaped);
   `stream/consumers.blob` builds the guest's global `Blob` at call time (Node: its own);
   `String(Blob)` is the generated text; the handle class (reachable through the `kHandle` symbol)
   is rifty's.

## Portability inventory

| Binding | Class / authority | Drift guard | Kill condition |
|---|---|---|---|
| JS byte store for `internalBinding('blob')` | platform-gap: no Node C++ in the isolate | read counts and slices pinned against live Node (`blob-file.test.ts`), WPT FileAPI per subtest | none (the isolate has no native binding) |
| errors, validator, types, intrinsics | substitution-environment | generator anchors + `blob-cases.cjs` + WPT | the isolate guest gets Node's `internal/errors` generated (a shared owner) |
| guest codec for `internal/encoding` | substitution-environment | `text()` rows | unit `isolate-guest-textdecoder-legacy-encodings` binds Node's `encoding.js` |

## Alternatives rejected

- npm `Blob` polyfills: 9/19 and 13/19 cases differ (Context).
- Hand TS port of `blob.js`: the same semantic copy without a drift check.
- A host bridge (bytes held by the host Node): outside the isolate's memory limit, a new host
  function over guest input amends ADR-0557 §6 — the goal's Outcome keeps it inside the isolate.
- Install the globals before the runtime loads: `blob.js` needs the runtime (Context).

## Consequences

- WPT `FileAPI/blob` + `FileAPI/file`, 8 `.any.js` files Node runs: 296 of 298 subtests equal live
  Node; the 2 excluded are `MessageChannel` (a blob part) and `stream()`.
- Re-pin of Node: rerun the generator, `blob-cases.cjs` and the WPT files.

## Cost

2026-11-26, M3 Pro, macOS, Node v24.16.0, isolated-vm 7.0.2, esbuild 0.28.0. Bundle: base =
origin/main `c2250727d`, change = this ADR's code merged on it. Warm call: 2026-11-25, base
`3d16cb7b8` vs the change at `680f9920e` (guest code unchanged since but for main's merges); load
below; no bound (goal Decisions).

| | base | change | Δ |
|---|---|---|---|
| `dist/guest.js` | 7 181 525 B | 7 223 180 B | +41 655 B (generated part 16 829 B) |
| `gzip -9` | 1 511 685 B | 1 522 093 B | +10 408 B |
| warm `runCode('1')`, median of 40, base and change alternating, 4 runs (load ~13) | 15.01–17.31 ms | 15.30–17.63 ms | +0.27 to +0.72 ms |

Throughput, declared, not tuned: 200 000 parts `'ab'` → `new Blob` + `text()` 3.2 s in `runCode`
(Node 0.3 s) — per part `blob.js`'s conversion and copy, the guest's JS UTF-8 encoder, a taken-over
buffer, two reads.

The warm Δ is the three files' and the bindings' evaluation in each fresh isolate (they load with
the runtime, Decision 4); no lazy install (an accessor global is observable, goal Decisions).
