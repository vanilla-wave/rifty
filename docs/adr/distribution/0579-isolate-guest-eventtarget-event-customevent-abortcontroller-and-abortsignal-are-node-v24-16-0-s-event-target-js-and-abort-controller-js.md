# ADR 0579: Isolate guest EventTarget, Event, CustomEvent, AbortController and AbortSignal are Node v24.16.0's event_target.js and abort_controller.js

Status: Accepted
Date: 2026-11

> TL;DR: in the isolate guest, `EventTarget`/`Event`/`CustomEvent`/`AbortController`/`AbortSignal`
> are Node v24.16.0's `lib/internal/event_target.js` + `abort_controller.js`, vendored, generated
> unedited and drift-checked (ADR-0574 pipeline), over node-blob's evaluated `internal/webidl` (one
> copy, ADR-0578); own parts are the bindings only. They are ordinary data globals installed with the
> runtime, before guest code. Transferring a signal (`MessageChannel`) is a named gap. Amends
> ADR-0557 §5: the five leave the closed ceiling list.

## Context

Unit `distribution/isolate-stream-core-abort-controller` (goal `node-streams-as-in-node` unit 7,
carrying I3 of goal `isolate-guest-web-api`; deleted on done, its decisions are here, in compat and
CHANGELOG). In the guest the five were ceiling throwers: every `signal` option of a Node API stopped
at `NotImplementedError('isolate-host.AbortController')`, and Node's own `pipeline` (stream core,
ADR-0575) creates an `AbortController` per call. Probe `reference/sources-js` of the Web API goal:
npm polyfills differ from Node on 22/31 cases (`new AbortSignal()` constructs, `abort()` twice fires
twice, `timeout`'s reason text, no `kResistStopPropagation`); Node's files 0/31. User's answer
(goal Decisions): ordinary globals, as in Node, not private to the stream core.

The two files need `primordials`, `internal/errors` (6 codes), five validators, `internal/webidl`,
`events` (`defaultMaxListeners` read per target, `kMaxEventTargetListeners(Warned)`), `util.inspect`,
`timers` (`setTimeout(…).unref()`), `process` (`nextTick`, `emitWarning`), `internal/perf/utils`
`now`, `internalBinding('messaging').DOMException`, `internal/worker/js_transferable` symbols and,
only to transfer a signal, `internal/worker/io`'s `MessageChannel`. Node's globals are data
properties from the start (`w1e0c1` before and after the first read, measured): no lazy install.

## Decision

1. Vendor `lib/internal/event_target.js` and `abort_controller.js` under
   `tools/publishing/node-event-target/vendor/` (sha256-pinned; `LICENSE` read from node-blob's
   pinned copy). `generate-node-event-target.mjs` (shared steps `node-sources.mjs`, the same helper
   the stream core's generator uses) checks each file's exact `require`/`internalBinding` ids and
   its one `primordials` header against the bindings, wraps each body in Node's builtin wrapper
   `(exports, require, module, process, internalBinding, primordials)`, cache-before-run as
   `BuiltinModule`, identifiers kept; `check:node-event-target-drift` checks the committed output.
   The factory returns both modules' exports (the stream core binds `kResistStopPropagation`,
   `kWeakHandler`, `AbortController`, `AbortSignal` from them). node-blob's factory also returns its
   evaluated `internal/webidl`, so `converters.AbortSignal` lands in the one `converters` table.
2. Bindings (`guest/node-event-target/bindings.ts`): `primordials` captured at bundle load with
   Node's `makeSafe` (copied members, safe iterators, null-prototype frozen prototypes) for
   `SafeMap`/`SafeSet`/`SafeWeakMap`/`SafeWeakSet`/`SafeWeakRef`/`SafeFinalizationRegistry`;
   `PromiseWithResolvers` as its ES2022 equivalent (ADR-0469 floor); validators as Node's text
   (`hideStackFrames` + `HideStackFramesError`); `internal/assert` Node's `ERR_INTERNAL_ASSERTION`;
   rifty's `EventEmitter` as `events` (Node's two symbols added to it on every host), rifty's
   `inspect`, timers and `process`; the guest's `DOMException` (today's class, the one Blob uses) and
   clock (`performance.now`'s). `internal/errors` (`guest/node-errors.ts`) and `internal/util`'s
   constants plus `js_transferable`'s symbols (`guest/node-internal.ts`) are now shared with
   node-blob: one table, one `kEmptyObject`, one symbol each. `internal/worker/io` →
   `NotImplementedError('isolate-host.MessageChannel')`.
3. Install (`entry.ts` `setUp`): after the runtime loaded, the ceilings and `Blob`/`File`, before
   guest code — the five as data globals (`w1e0c1`). The shim (`web-shim.ts`, esbuild's inject)
   exports them as live bindings under other local names, so the bundle's bare references (the
   kernel's call-time `new AbortController()`) are the real classes and no bundle symbol is named
   like Node's classes (ADR-0577's fix for renamed classes). Browser hosts are untouched (native).
4. The runtime's own abort listeners resist `stopImmediatePropagation()` as Node's: `@riftydev/io`
   holds Node's `kResistStopPropagation` once the isolate binds it (`bindNodeEventTargetSymbols`);
   `events.addAbortListener`, `events.once`, `addAbortSignal` and the stream helpers pass it. Unbound
   on browser hosts (their `EventTarget` is the host's; backlog
   `runtime-js/stream-core-abort-listeners-host-event-target`).
5. `events.once(emitter, name, options)` is Node's `lib/events.js` `once` on every host (it was a
   2-argument helper ignoring `options`): `options.signal`, EventTarget emitters, Node's errors.

## Portability inventory

| Binding | Class / authority | Drift guard | Kill condition |
|---|---|---|---|
| errors, validators, assert | substitution-environment | generator anchors + `abort-cases.cjs` + WPT `dom` | the guest gets Node's `internal/errors`/`validators` generated (stream core, ADR-0575) |
| `primordials` subset (`makeSafe`) | substitution-environment | `abort-intrinsics.cjs` (replaced intrinsics) | Node's `per_context/primordials.js` generated for the guest |
| `DOMException` = web-shim's | substitution-environment | `abort-cases.cjs` (`reason` rows) | Node's `per_context/domexception.js` in the guest (`distribution/isolate-guest-domexception-node-shape`) |
| `MessageChannel` gap | platform-gap: ports are ceilings | `abort-cases.cjs` `kTransferList` row | the guest gets `MessageChannel` |

## Alternatives rejected

- npm polyfills (`event-target-shim`, `abortcontroller-polyfill`): 22/31 cases differ.
- A second `webidl.js` copy: two `converters` tables, duplicated bytes.
- Lazy accessor globals: Node's are data properties; observable.
- Classes private to the stream core: the user's answer (goal Decisions).

## Consequences

- WPT `dom/abort` + `dom/events`, the 13 `.any.js` files Node runs: 76 of 76 subtests equal live
  Node (74 pass, `Event-isTrusted` and `EventTarget-removeEventListener` fail in both); not run:
  `timeout-shadowrealm.any.js` (ShadowRealm) and every `.html`/`.window.js`/`.worker.js`.
- The unit's table (`abort-event-target.test.ts`): globals, shapes, names, errors, statics, signal
  APIs equal Node in `exec` and `runCode` but the declared rows (compat `isolate-host.md`).
- Not Node (declared): `util.inspect` of the classes (rifty's inspect reads no `inspect.custom`; the
  MaxListeners warning names the target `[Object]`); `DOMException`'s own `message`; `String(class)`
  is the generated text; weak listeners and `AbortSignal.any`'s GC cleanup run on the isolate's GC,
  not proven by a test (no `gc()` in the guest).
- Re-pin of Node: rerun the generator, `abort-cases.cjs` and the WPT files.

## Cost

2026-11-26, M3 Pro, macOS, Node v24.16.0, isolated-vm 7.0.2, esbuild 0.28.0. Base = origin/main
`be99bee9e`, change = this ADR's code. Warm `runCode('1')`: alternating triples (ABA/BAB) after 20
warm-ups each, n = 240 per side, median Δ with a 2 000-sample bootstrap 95 % interval; no bound
(goal Decisions).

| | base | change | Δ |
|---|---|---|---|
| `dist/guest.js` | 7 383 235 B | 7 441 458 B | +58 223 B (generated part 31 798 B) |
| `gzip -9` | 1 570 874 B | 1 581 877 B | +11 003 B |
| warm `runCode('1')`, median (p10–p90), load 5.2 | 17.84 (15.50–24.46) ms | 18.67 (16.23–24.89) ms | +0.83 ms (95 % 0.11–1.45) |

The warm Δ is the two files' and the bindings' evaluation in each fresh isolate (eager, as Node's
globals are data properties).
