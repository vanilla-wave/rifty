---
area: distribution
status: ready
title: The isolate guest's EventTarget, Event, CustomEvent, AbortController and AbortSignal are Node v24.16.0's own classes as ordinary globals, so Node's APIs taking a signal work there and Node's stream core can bind them
created: 2026-11-25
why: Node's pipeline creates an AbortController per call and every `signal` option needs one; in the isolate guest the five were ceiling throwers
epic: node-streams-as-in-node
blocked_by: [runtime-js/fs-callbacks-io-turn]
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/map.md, docs/backlog/epics/isolate-guest-web-api/goal.md, docs/backlog/epics/isolate-guest-web-api/reference/sources-js/README.md, docs/adr/distribution/0579-isolate-guest-eventtarget-event-customevent-abortcontroller-and-abortsignal-are-node-v24-16-0-s-event-target-js-and-abort-controller-js.md]
code: [packages/isolate-guest/src/guest/node-event-target/bindings.ts, packages/isolate-guest/src/guest/web-shim.ts, packages/isolate-guest/src/guest/entry.ts, packages/runtime-js/src/builtins/events.ts, packages/io/src/node-event-target-symbols.ts, packages/isolate-host/tests/abort-event-target.test.ts, packages/isolate-host/tests/wpt-dom.test.ts]
---

## Context

Unit 7 of goal `node-streams-as-in-node` (map), ADR-0575 §6; carries I3 of goal
`isolate-guest-web-api` (on main; map «Delivered elsewhere») together with
`runtime-js/events-static-surface` (`events.on`, the statics) and `runtime-js/signal-apis-as-node`
(`timers/promises`) — manager's decision 2026-11-26: this unit is Node's classes, the globals, the
bindings and what they close without changing rifty code on other hosts, plus `events.once`
(io, every host) and the fs `signal` checks on top of #468.

Why: `lib/internal/streams/pipeline.js:195` creates `new AbortController()` per call,
`operators.js:65,252` pass `{ signal }` to user functions; on main `be99bee9e` the isolate's
`new AbortController()`/`new EventTarget()`/`new Event('x')` throw `isolate-host.*`,
`AbortSignal.timeout` → `TypeError`, every `signal` row of I3 stops at `isolate-host.AbortController`
(`isolate-guest-web-api/reference/today`). User's answer (goal Decisions): ordinary globals, as in
Node. Node's globals are data properties before and after the first read (measured, `w1e0c1`).

## Open findings (review round 4) — closed

- S1 (isolate row ownership by names): unit 7's share closed by data; the route-B isolate column and
  `w1` stay with 8c (`runtime-js/stream-core-node-sources`, S1 there). This unit measures the
  isolate's `m7`/`m9`/`m10` on rifty's current stream — `sandbox.exec` of each program on a build of
  origin/main `be99bee9e` and on this unit's build, Node = `node <program>` v24.16.0 — and pins the
  after state (`abort-event-target.test.ts`):
  `m7` 0/11 = Node before and after (rifty's `pipeline`: no function/generator stages, `finished`'s
  callback arguments) → 8c; `m9` was 0/5 (`NotImplementedError` at `new AbortController`), now 3/5
  (`addAbortSignal`, `map`, `reduce` with a stopping listener), `pipeline(…, {signal})` and
  `finished(r, {signal}, cb)` (rifty's take no options) → 8c; `m10` was 0/3 (the same gap), now
  `TypeError` in row 1 (`pipeline` options) → 8c, `n/a` in row 2 (`events.getEventListeners`
  absent) → `runtime-js/events-static-surface`, and an uncaught `cb is not a function` (rifty's
  `finished` calls the options) → 8c. That Node's stream core runs over these classes in the
  isolate is 8a/8c's proof (route B), not a row here. Node: `m9` 5/5
  `ABORT_ERR`, `m10` `destroyed=true`, `10000`, `0`.
- S4 (no rows, no Acceptance): below.

## Acceptance

1. Node v24.16.0 `lib/internal/event_target.js` + `abort_controller.js` vendored, sha256-pinned,
   generated unedited by `generate-node-event-target.mjs` (exact `require`/`internalBinding` ids and
   `primordials` names checked), drift-checked in CI and `pr:check`
   (`check:node-event-target-drift`), listed in the third-party manifest; `internal/webidl` is
   node-blob's evaluated copy (no second copy). → ADR-0579
2. The five are guest globals with Node's descriptors (`data function w1e0c1`), names, lengths,
   parents, prototype members and descriptors, `Symbol.toStringTag`, statics, and
   `Class constructor X cannot be invoked without 'new'`, in `exec` and `runCode`
   (`abort-event-target.test.ts`). → I3
3. WPT `dom/abort` + `dom/events` (Node's vendored copy) through the shared harness: every subtest of
   the 13 `.any.js` files Node runs equals live Node (76/76; `Event-isTrusted`,
   `EventTarget-removeEventListener` fail in both, compared); not run, each with a `gap` probe:
   `timeout-shadowrealm.any.js` (ShadowRealm) and every `.html`/`.window.js`/`.worker.js`
   (`wpt-dom.test.ts`). → I3
4. `AbortSignal.abort`/`timeout`/`any`, `throwIfAborted`, their argument errors (`ERR_OUT_OF_RANGE`,
   `ERR_INVALID_ARG_TYPE`, `ERR_ILLEGAL_CONSTRUCTOR`, `ERR_INVALID_THIS`), `any`'s reason order;
   `signal.reason instanceof DOMException` (the guest's global, the class `Blob` uses), `name`,
   `code` 20 / 23, message, as Node. → I3
5. Node's APIs taking a `signal` in the guest equal Node: `events.addAbortListener` (an earlier
   `stopImmediatePropagation()` does not hide the abort), `events.once(emitter, name, {signal})`
   (Node's `lib/events.js` `once` on every host: aborted before / same tick / microtask / after the
   event / never, bad signal, no listener left — parity `events/once-signal`). `events.on`/statics
   and `timers/promises` are pinned as today with their owners (`runtime-js/events-static-surface`,
   `runtime-js/signal-apis-as-node`). `child_process` signals: the module is a gap in the isolate
   (no row). → I3
5a. On top of #468, every host: `validateAbortSignal` + Node's `checkAborted` at call and before the
   result is delivered, in `fs.readFile`/`writeFile`/`appendFile` and `fs.promises.readFile`/
   `writeFile`/`appendFile`. Reads equal Node for a signal aborted before the call, `abort()` in the
   same tick, in a microtask, after completion (no effect), a bad `signal` (`ERR_INVALID_ARG_TYPE`);
   writes for aborted before the call (`AbortError`, nothing written), after completion and a bad
   `signal`. Declared remainder (owner `runtime-js/signal-apis-as-node`): a write aborted after the
   call, same tick or microtask — Node `ABORT_ERR` and the file created empty (measured v24.16.0:
   size 0), rifty `ABORT_ERR` with the file written. Proof: parity case over the in-process host +
   the isolate rows. → I3
6. Replaced intrinsics after load (`Array.prototype.*`, its iterator, `Function.prototype.call/apply/
   bind`, `Promise.prototype.*`, `Map`/`Set`/`WeakMap`/`WeakSet`/`WeakRef`/`FinalizationRegistry`
   prototypes, `Object.*`, `Reflect.apply`) change the classes' results as they change Node's
   (`abort-intrinsics.cjs`), but the declared rifty-runtime row. → ADR-0579
7. Lifecycle: a pending `AbortSignal.timeout` does not keep the process alive and fires while
   something else does; a sandbox stopped with thousands of pending timeout signals and listeners
   ends at its deadline with no busy worker after. → I3
8. The runtime's bare `AbortController` references are the real class (shim live bindings, no
   renamed class in the bundle: `bundle-public-names`, `AbortController.name` row). → ADR-0579
9. The streams goal's isolate rows `m7`/`m9`/`m10` pinned as measured (S1 above); `m9`'s three
   rows equal Node. → I7
10. Cost measured and recorded: `guest.js` and gzip bytes, warm `runCode('1')` Δ by alternating
    triples, n ≥ 200 (ADR-0579 §Cost). → ADR-0579

## Reference contract

- Oracle: live Node v24.16.0 (`node <file>`), same files; WPT: Node v24.16.0 `test/fixtures/wpt/dom`
  (abort `dc928169`, events `0a811c51`), compared per subtest with live Node, never its status files.
- Mechanism: Node's own `event_target.js`/`abort_controller.js` text under rifty bindings (ADR-0574
  pipeline; ADR-0578's `webidl.js`).

## Parity cases

1. `abort-cases.cjs` (147 observation lines): globals, shapes, errors, statics, dispatch semantics, `signal`
   options, MaxListeners warning, transfer path; Node = guest but `CASES_DECLARED`. → I3
2. `abort-intrinsics.cjs`: the replaced-intrinsics table. → ADR-0579
3. `tools/node-parity-runner/cases/events/once-signal.case.ts` (every host); the fs `signal` parity
   case (every host, with 5a). → I3
4. WPT `dom/abort`, `dom/events` (13 files). → I3
5. `m7`, `m9`, `m10` (`fixtures/streams-scenario/`) in the isolate. → I7

## Out of scope

- `MessageChannel` transfer of a signal: `NotImplementedError('isolate-host.MessageChannel')`
  (compat `isolate-host.md`); `structuredClone`/`postMessage` stay ceilings.
- `util.inspect` of the classes (`inspect.custom`, compat ❌ `util.inspect.custom`,
  `runtime-js/util-surface-completions`).
- `DOMException`'s shape (`distribution/isolate-guest-domexception-node-shape`).
- `events.on`, `getEventListeners`, `get/setMaxListeners` (`runtime-js/events-static-surface`);
  `timers/promises` `signal` and a write aborted after its call (`runtime-js/signal-apis-as-node`).
- Browser hosts' `EventTarget` and `kResistStopPropagation` there
  (`runtime-js/stream-core-abort-listeners-host-event-target`).
- GC-proven cleanup of weak listeners and `AbortSignal.any` (no `gc()` in the guest).

## Decisions

- 2026-11-25 — user (goal Decisions): ordinary globals, as in Node; manager M1: `CustomEvent` with the four.
- 2026-11-26 — manager: `events` surface and `timers/promises` are other carriers of I3; `events.once`
  and fs `signal` (on #468) here, the write-after-call remainder declared; `addAbortListener` with
  `kResistStopPropagation` through a binding; until #468 is in main the PR stays draft.
- 2026-11-26 — agent: eager data globals (Node's are data from the start); errors/validators/
  primordials as rifty bindings with Node's text, shared with node-blob (ADR-0579).
- 2026-11-26 — agent: the `kResistStopPropagation` seam lives in `@riftydev/io` (lowest layer using
  abort listeners); unbound on browser hosts.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
challenge: 2026-11-26 — reused for ready: promises unchanged but the carrier split (manager's decision above)
