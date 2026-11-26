---
area: runtime-js
status: draft
title: Node APIs taking a `signal` — `timers/promises`, and the `fs` write aborted after its call — behave as Node's on every host
created: 2026-11-26
why: rifty's `timers/promises` rejects with the abort reason itself and checks no options; rifty's `fs` file APIs ignore `signal` (unit 7 adds Node's checks on #468; a write aborted after its call still writes the file)
epic: isolate-guest-web-api
blocked_by: [runtime-js/fs-callbacks-io-turn, distribution/isolate-stream-core-abort-controller]
sources: [docs/adr/distribution/0579-isolate-guest-eventtarget-event-customevent-abortcontroller-and-abortsignal-are-node-v24-16-0-s-event-target-js-and-abort-controller-js.md, PR-472, PR-468]
code: [packages/runtime-js/src/builtins/timers.ts, packages/runtime-js/src/builtins/fs.ts, packages/isolate-host/tests/abort-event-target.test.ts, docs/backlog/runtime-js/reference/signal-apis-probe.cjs]
---

## Context

Carrier of the rest of I3 of goal `isolate-guest-web-api` («Node's APIs taking a `signal` … equal
Node in the guest»), with `runtime-js/events-static-surface` (`events.on`/statics) and unit
`distribution/isolate-stream-core-abort-controller` (the classes, `events.once`,
`addAbortListener`; PR #472). After that unit (manager's decision, 2026-11-26).

Measured 2026-11-26, Node v24.16.0, probe `reference/signal-apis-probe.cjs` (its header: commands);
isolate = `sandbox.exec` on PR #472 (Node's `AbortSignal` in the guest); in-process = the parity
runner (rifty's browser-host code over Node's native `AbortSignal`, the browser hosts' code path).
Both rifty columns are equal on every row (the `{signal: 1}` row: `abort-cases.cjs`-style run in the
isolate only). Rows marked † are closed by unit 7 on top of #468 (its Acceptance 5a):

| call | Node | rifty (isolate, in-process) |
|---|---|---|
| `timers/promises.setTimeout(5,'v',{signal: AbortSignal.abort()})` | `AbortError` `ABORT_ERR`, `cause` = reason | rejects with the `DOMException` reason itself (`AbortError`, code 20) |
| `setTimeout(50,'v',{signal})`, `abort()` after the call | same `AbortError` | the reason itself |
| `setImmediate('v',{signal: AbortSignal.abort('why')})` | `AbortError`, `cause` `'why'` | rejects with `'why'` |
| `for await (… setInterval(1,'i',{signal: aborted}))` | `AbortError` | the reason itself |
| `setTimeout('x','v')` | `ERR_INVALID_ARG_TYPE` (`"delay"`) | resolves `'v'` after a `TimeoutNaNWarning` |
| `setTimeout(1,'v',null)` | `ERR_INVALID_ARG_TYPE` (`"options"`) | `TypeError` without `code` |
| `setTimeout(1,'v',{ref: 1})` | `ERR_INVALID_ARG_TYPE` (`"options.ref"`) | resolves `'v'` |
| `setTimeout(1,'v',{signal: 1})` | `ERR_INVALID_ARG_TYPE` (`"options.signal"`) | `signal.addEventListener is not a function`, then an uncaught `signal.removeEventListener is not a function` ends the process |
| † `fs.readFile(f,{signal: aborted},cb)` | `AbortError` | the data |
| † `fs.readFile(f,{signal},cb)`; `abort()` right after | `AbortError` | the data |
| † `fs.readFile(f,{signal: {}},cb)` | `ERR_INVALID_ARG_TYPE` (`"options.signal"`) | the data |
| † `fs.promises.readFile(f,{signal: aborted})` | `AbortError` | the data |
| † `fs.promises.writeFile(g,'x',{signal: aborted})`, `fs.writeFile(…, cb)` | `AbortError`, no file | resolves; the file is written |
| † `fs.promises.appendFile(…, {signal: aborted})` | `AbortError` | resolves; written |
| `fs.writeFile(f,'xyz',{signal},cb)`; `abort()` right after | `ABORT_ERR`, file size 0 | success, size 3 (after unit 7: `ABORT_ERR`, size 3) |
| `fs.promises.writeFile(f,'xyz',{signal})`; `abort()` in a microtask | `ABORT_ERR`, size 0 | resolves, size 3 (after unit 7: `ABORT_ERR`, size 3) |

Pinned in the isolate: `packages/isolate-host/tests/abort-event-target.test.ts` `CASES_DECLARED`.
Before PR #472 the isolate rows stopped at `NotImplementedError('isolate-host.AbortController')`;
the fs rows became a silent wrong result there, and the manager's decision (PR #472) is that unit 7
lands the fs `signal` checks on top of #468 (`validateAbortSignal` + Node's `checkAborted` at call,
again before a read's result): this draft keeps the `timers/promises` rows, and the fs rows that
unit leaves (a write aborted after the call: Node creates the file empty, rifty writes it whole).

Node's behavior source: v24.16.0 `lib/timers/promises.js` (`cancelListenerHandler`,
`AbortError(undefined, { cause })`, `validateNumber`/`validateObject`/`validateAbortSignal`/
`validateBoolean` before scheduling, `kResistStopPropagation` listeners); `lib/fs.js` `checkAborted`
(readFile, writeFile at call; `ReadFileContext` before each read; `writeAll` before each write) and
`lib/internal/fs/promises.js` `checkAborted` (readFile before open, after fstat, before each read;
writeFile before open and before each write); `getOptions` validates `options.signal`.

## Question

- (open) On browser hosts `kResistStopPropagation` meets the host's `EventTarget`, which ignores it:
  an earlier listener's `stopImmediatePropagation()` hides the abort from `timers/promises` there
  (isolate: Node's `EventTarget`, resolved by ADR-0579's seam). Same question as
  `runtime-js/stream-core-abort-listeners-host-event-target` (AL); not decided here.

## Challenge

challenge: 2026-11-26 — none (finding capture; README §Challenge)
