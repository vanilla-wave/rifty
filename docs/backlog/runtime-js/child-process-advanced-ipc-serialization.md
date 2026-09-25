---
area: runtime-js
status: ready
title: `child_process.fork` with `serialization: 'advanced'` carries messages as Node's v8 serializer does
created: 2026-09-15
why: vitest's default forks pool calls `fork(entry, [], { env, execArgv, stdio: 'pipe', serialization: 'advanced' })`; rifty throws `NotImplementedError('child_process.serialization.advanced')` at spawn, so the default pool cannot start
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md, docs/adr/runtime-js/0448-carry-advanced-fork-ipc-as-a-native-structured-clone.md, docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/adr/kernel/0326-federated-worker-child-tree-with-separate-public-ipc-and-private-control.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-worker.ts, packages/runtime-js/src/builtins/child_process-exec.ts, packages/runtime-js/src/internal/node-ipc-serialization.ts, packages/runtime-js/src/builtins/node-entry-runtime-config.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

Oracle (Node v24.16.0, evidence §Oracle): `fork(child, [], { serialization:
'advanced', stdio: 'pipe' })` keeps every V8-serializable type both ways,
keeps `Buffer` a `Buffer`, copies views to exactly their bytes, and refuses
functions, symbols, proxies, promises, weak collections and SharedArrayBuffer
with a plain `Error` `<x> could not be cloned.`. vitest 4.1.11's forks pool
sends only plain objects, arrays, null-prototype objects and primitives, but
with `undefined` members/arguments and circular task graphs, which JSON drops
or refuses (evidence §vitest traffic).

On BASE `spawn()` throws for any `serialization: 'advanced'` and passes every
other value as JSON, the node-entry program launch accepts only `ipc: 'none' |
'json'`, and the child's IPC keepalive is gated on JSON (`process.ts`
`#syncIpcKeepalive`). Chromium's structured clone is V8's serializer with
Blink's hooks: same types, Error mapping, getter order and refusal text, but a
different view/Buffer, SharedArrayBuffer, error-class and platform-object story
(evidence §Chromium). Carrier: ADR-0448.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P4 cost shown)

## Reference contract

- Oracle: Node v24.16.0 `child_process.fork` with `serialization: 'advanced'`
  (`lib/internal/child_process/serialization.js` `ChildProcessSerializer` over
  `lib/v8.js` `DefaultSerializer`, i.e. V8's `ValueSerializer` with Node's
  ArrayBuffer-view host hook), driven by vitest 4.1.11's forks pool (vite
  8.0.16 tree). Browser twin: Chromium 148 `structuredClone` in a COI Worker.
- Mechanism (ADR-0448): the sender's native `structuredClone` decides
  traversal, getters and refusals; one codec fixes the four Chromium
  differences (views copied to their bytes with the Buffer brand read like
  Node's `_writeHostObject`, SharedArrayBuffer refused, refusal errors as
  Node's plain `Error`, platform objects a named throw) and ships
  `[value, buffers]` over ADR-0326's existing public lane; node-entry v5 carries
  `ipc: 'advanced'` to the child.

## Acceptance

1. `fork(entry, [], { serialization: 'advanced', stdio: 'pipe' })` no longer throws at spawn and carries vitest 4.1.11's forks-pool frame shapes (Parity case 6) both ways with `undefined` members/arguments and circular task graphs as Node does, on the Worker route in the parity runner (`public-ipc-advanced.case.ts`) and in a real Chromium child realm (`tests/browser-unit/advanced-ipc.spec.ts`, live Node oracle). → I4, ADR-0448
2. Parity cases 1–5, 7 and 8 hold on the Worker route in the parity runner (`public-ipc-advanced.case.ts` matches live Node) and in a real Chromium child realm running the same program verbatim (browser-unit `values`, live Node oracle), including Chromium's own refusal errors and SharedArrayBuffer. → ADR-0448
3. The fork child's IPC lane holds its realm while it has a `'message'` listener in both serializations and releases it on listener removal or disconnect, while a launch-less URL Worker sharing the physical port stays unheld (`packages/runtime-js/src/ipc/install-process-advanced-ipc.test.ts`, Parity case 8). → I4, ADR-0448
4. The same codec serves rifty's same-realm fallback route: Parity case 10 matches live Node (`public-ipc-advanced-same-realm.case.ts`), and the browser-unit runs that program too. → ADR-0448
5. `serialization` is validated and ignored without IPC as in Node (Parity case 9, `public-ipc-advanced-options.case.ts` and browser-unit `options`). → ADR-0448
6. Values Node's serializer writes but a browser clone cannot carry Node's way fail at `send()` by name, leave nothing posted and keep the channel usable (an echo child receives only the next message): `NotImplementedError('child_process.serialization.advanced.host-object')` for `Blob`, `DOMException`, `URL` and an untransferred `MessagePort` in the Node host (`child_process-advanced-ipc-ceiling.test.ts`) and for `Blob`, `File`, `DOMException`, `URL`, `AbortController`, `TextEncoder`, `Headers` and `MessagePort` in Chromium (browser-unit ceiling test, whose live Node run sends each); `…detached-array-buffer` for a detached ArrayBuffer and a view over one; `…accessor-with-view` for an own accessor beside or returning a Buffer or other view. The detached pair and a getter beside a Buffer also run in Chromium, whose refusal text carries a `Failed to execute …: ` prefix. → ADR-0448
7. node-entry moves to `rifty.node-entry/v5`: a program launch carries `ipc: 'advanced'`, other `ipc` values are rejected, and v2–v4 envelopes are neither read nor used as a fallback (`node-entry-runtime-config.test.ts`). → ADR-0448
8. The default JSON path keeps its behavior (`public-ipc-json.case.ts` stays green); only its top-level refusal text gains Node's `Received …` suffix, shared with advanced: Parity case 11 matches live Node on the Worker route and the same-realm route (`public-ipc-json-refusal-text{,-same-realm}.case.ts`). → ADR-0448
9. `docs/public/compat/process.md` marks advanced serialization ✅ and lists each ADR-0448 named throw ❌ and each ADR-0448 residual and the unclaimed view layout ⚠️. → ADR-0448

## Parity cases

Carriers: `tools/node-parity-runner/cases/child_process/public-ipc-advanced{,-fault,-options,-same-realm}.case.ts`
(shared pieces `advanced-ipc-program.ts`), run by the parity runner against
live Node and, verbatim, by `tests/browser-unit/advanced-ipc.spec.ts` in a
Chromium child realm against live Node; case 11:
`public-ipc-json-refusal-text{,-same-realm}.case.ts` (shared program
`json-ipc-refusal-program.ts`), parity runner only. Node rows: evidence §Oracle.

1. Intrinsic values round-trip parent → child → parent with Node's types: string, number, boolean, null, Date (and an invalid Date), Map, Set, RegExp (`lastIndex` back to 0), nested BigInt, `-0`, `NaN`/`±Infinity`, `undefined` in arrays and properties, sparse arrays, extra array properties, circular and shared references, the four boxed primitives. → ADR-0448
2. What V8 drops is dropped: class instances and null-prototype objects arrive as plain `Object`, non-enumerable and symbol-keyed properties are gone, and an own getter runs exactly once. → ADR-0448
3. Errors keep class, `message`, `stack` and `cause` for `Error`/`TypeError`/`RangeError`; a subclass, a custom `name` and `AggregateError` arrive as `Error`; an `Error` whose own `name` is `'TypeError'` arrives as `TypeError`. → ADR-0448
4. Views keep type and exactly their bytes (`Uint8Array`, `Float64Array`, `Float16Array`, `BigInt64Array`, `DataView`, a `subarray`), own properties drop, a `Uint8Array` subclass arrives as `Uint8Array`, two views over one buffer and a view beside its `ArrayBuffer` arrive independent (a write to one leaves the other unchanged), the same view twice stays one object, a view as a Map key round-trips, and a SharedArrayBuffer-backed view arrives as an unshared copy. → ADR-0448
5. `Buffer.from`, `Buffer.alloc`, a nested Buffer and a `Uint8Array` whose own `constructor` is `Buffer` arrive as `Buffer` (`Buffer.isBuffer`, `constructor === Buffer`) parent → child and child → parent, with child-originated Map/Set/Date, `RangeError` with `cause`, SharedArrayBuffer view, two views and circular task. → ADR-0448
6. vitest 4.1.11 forks-pool frames: `start` request with `undefined` config fields, birpc `fetch` request with `undefined` arguments, reply `{ t: 's', i, r: undefined }`, `onCollected` with circular `file`/`tasks` and null-prototype `meta`, `testfileFinished` with `undefined` members. → I4
7. Refusals, parent and child side: top-level `undefined` → `TypeError` `ERR_MISSING_ARGS`; top-level function, symbol and bigint → `TypeError` `ERR_INVALID_ARG_TYPE` with Node's `Received …` text; nested function, arrow, symbol, proxy (top-level too), Promise, WeakMap, WeakRef, generator, `Intl.NumberFormat` and SharedArrayBuffer → plain `Error` `<x> could not be cloned.` with no `code`; getters before the refused value ran and after it did not; a throwing getter's own error propagates; the channel stays usable. → ADR-0448
8. An echo child whose only holder is `process.on('message')` is alive and connected after 300 ms idle and exits 0 after the parent disconnects. → I4, ADR-0448
9. `serialization` `'bogus'`, `'JSON'`, `1` and `null` → `TypeError` `ERR_INVALID_ARG_VALUE` with Node's message, in `fork` and (`'bogus'`) in a plain `spawn`; `spawn('node', …, { serialization: 'advanced' })` without IPC runs normally. → ADR-0448
10. Same-realm route: a message is a copy fixed at `send()` (a parent write after send and a child write to the received value are invisible across, the echo is not the sent object), Map/Set/Date/`undefined`/Buffer/`Uint8Array`/`TypeError`/circular round-trip, a nested function is refused with the plain `Error`, a child Buffer arrives as `Buffer`, and the child's `process.disconnect()` ends with `'disconnect'` and exit 0. → ADR-0448
11. Default JSON serialization, parent and child side, Worker and same-realm routes: top-level `undefined` → `TypeError` `ERR_MISSING_ARGS`; an anonymous and a named function, a symbol and a bigint → `TypeError` `ERR_INVALID_ARG_TYPE` with Node's `Received …` text (`Received function `, `Received function namedFn`, `Received type symbol (Symbol(<description>))`, `Received type bigint (1n)`); the child still exits 0. → ADR-0448

## Fault matrix

Boundary: MessagePort / dedicated Worker, owner ↔ child (`docs/process/rules/fault-classes.md` §Boundary failure models): loss, duplication and reorder are excluded; peer death is total inflight loss after what was posted.

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| peer death × messages a child posted before ending naturally or crashing in a timer | delivered in order, then `'disconnect'`, then `'exit'` 0 / 1; `send()` after exit returns `false`; nothing replayed | `public-ipc-advanced-fault.case.ts` rows `burst-then-natural-exit`, `crash-after-send` (live Node) | → ADR-0448 |
| concurrent-same-key × sender writes after `send()` to the object, a SharedArrayBuffer view and a Buffer | the peer sees the values and bytes as they were at `send()` | fault case `echo-replies` rows `*-written-after-send`, `mutated-after-send` | → ADR-0448 |
| observable-order × a refused send between two accepted sends | throws synchronously, posts nothing, the next messages arrive in order | fault case `echo-replies` + `refusal`; named throws: ceiling test and browser-unit ceiling `received` (echo child sees only the next message) | → ADR-0448 |
| sibling-drift × encode/decode at parent Worker, child Worker and same-realm sites | one codec: identical rows on every route and in Chromium; the JSON sites share the top-level text | values case (both directions), same-realm case, browser-unit programs; JSON: Parity case 11 on both routes | → ADR-0448 |
| corrupt-input × a child bundle older than the launch (version skew) | refused before user entry by protocol mismatch; never a JSON child on an advanced parent | `node-entry-runtime-config.test.ts` retired v2–v4 | → ADR-0448 |

## Out of scope

- Platform objects in an advanced message (`Blob`, `File`, `DOMException`,
  `URL`, `AbortController`, `TextEncoder`, `Headers`, `MessagePort`,
  `WebAssembly.Module`, …): `NotImplementedError('child_process.serialization.advanced.host-object')`.
  Node sends most as a plain object of their own enumerable properties, a
  `DOMException` as a message-less `Error` (a wasm module crashes its
  receiver). Compat ❌.
- A detached ArrayBuffer or a view over one:
  `NotImplementedError('child_process.serialization.advanced.detached-array-buffer')`.
  Node throws `Error` / `TypeError`. Compat ❌.
- An own accessor on the traversal path of a message holding an ArrayBuffer
  view: `NotImplementedError('child_process.serialization.advanced.accessor-with-view')`.
  Node sends it. Compat ❌.
- Received view layout (`byteOffset`, one shared message buffer): not claimed,
  ADR-0448 §Not claimed. Compat ⚠️.
- Error-path residuals: a SharedArrayBuffer or host object before a later
  V8-refused value names the later value, and getters after it run; the
  `constructor` read happens after the clone. ADR-0448 §Explicit gaps. Compat ⚠️.
- `send()` handles, callbacks and options, and channel `ref()`/`unref()`: the
  existing `process.send.arguments` / `child_process.send.arguments` throws,
  unchanged.
- `execArgv` on `fork`: map item 11.

## Decisions

ready-verdict: 2026-09-23 — Contract+RED @ c378b464f8c20e5b75d57d4b9f2c22c4fe28051a

- 2026-09-23 — pickup: carrier ADR-0448 (native clone plus one codec, node-entry v5). Rejected: raw passthrough (#349), hand-walked snapshot codec (#351), preflight walk with ceilings (#352), a JS copy of V8's wire format; evidence in ADR-0448 §Rejected.
- 2026-09-23 — scope: vitest's own traffic needs plain data with `undefined` and cycles (I4 rows); the rest of the value table and the named throws are ADR-0448's, because Fidelity makes every accepted value Node-faithful or a named throw.
- 2026-09-23 — top-level refusal text: the validation shared by both serializations gains Node's `Received …` suffix; JSON serialization itself is unchanged.
- 2026-09-23 — protocol: node-entry v4 → v5 under ADR-0267's rule; the runtime-js v4 pins move at RED, the workbench fixtures and the parity harness default at IMPLEMENT.
- 2026-09-23 — RED shape: the two child-worker cases fail on the harness Worker count because fork throws before any Worker exists; the same program on the same-realm route prints that `NotImplementedError` (evidence §Baseline). The other carriers fail on the asserted rows.
- 2026-09-23 — DEC-2: overturning ADR-0326's advanced loud-gap clause and ADR-0416's active v4 version is recorded as dated notes; independent decision review: the Contract+RED r1 reviewer found both corrections justified (ADR-0326's clause closes into the carried lane with handles/callbacks/`ref()` still gaps; v4 → v5 follows ADR-0267's widened-launch rule).
- 2026-09-23 — discoveries outside this result (route at land, REV-12): Node emits an async `ERR_IPC_CHANNEL_CLOSED` `'error'` on `send()` after disconnect, rifty none (both serializations); a same-realm child's top-level `const process` is a SyntaxError because the wrapper passes `process` as a parameter; Node's fork child also holds its channel for a `'disconnect'` listener (evidence §Keepalive), rifty's `#syncIpcKeepalive` counts only `'message'`, and on the same-realm route a parent `disconnect()` leaves a listening child's hold in place (r1 reviewer probe; both serializations; vitest's child uses neither).
- re-cut: 2026-09-23 — Contract+RED r1: Acceptance 8 gains its RED carrier (Parity case 11, JSON top-level text both sides and routes); Acceptance 6 asserts "nothing posted" with an echo child and runs the detached and accessor throws in Chromium; Parity case 9 adds a plain-spawn `'bogus'` row; out-of-scope platform-object wording matches evidence (DOMException) — trace: none
- 2026-09-23 — required repair (REV-12): the browser-unit same-realm program (Worker route in Chromium, fork's default inherited stdin, open terminal stdin) printed Node's rows, then timed out: the parent's `process.stdin` was forwarded to the child with a `'data'` listener, which made it flowing and held the parent past the child's close (both serializations). Node shares fd 0: the parent's stdin stays unread and unheld (evidence §Inherited stdin). Fixed at the stdin reader (`builtins/process-stdin-inherit.ts`); RED `child_process-inherit-stdin.test.ts`; CHANGELOG line (reversible fix).
- 2026-09-23 — discovery outside this result (route at land, REV-12): on the same-realm route a child's `process.send()` after `process.disconnect()` returns `true` and delivers (Node v24.16.0: `false`, nothing delivered; scratch parity probe, default JSON).
- 2026-09-25 — DEC-2 decision review of ADR-0448 (corrects ADR-0326, ADR-0416 v4): justified-with-fixes. Fixes applied: ADR-0326's launch-plan `ipc: 'none' | 'json'` clause named in ADR-0448 §Consequences, a dated ADR-0326 note under §One validated launch plan and the README §Corrections row.
