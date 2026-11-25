---
area: runtime-js
status: draft
title: Runtime lifecycle work after guest code uses guest-replaceable intrinsics
created: 2026-11-18
why: The drain, keepalive and exit paths call `Map.prototype.get`, `Function.prototype.bind`, `Promise.prototype.constructor` and `process.emit` through the live globals, so guest code can change or hang its own run's outcome.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/builtins/os.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/timers.ts, packages/runtime-js/src/builtins/process-lifecycle-events.ts]
---

## Context

Sandbox (ADR-0568): a member of the lifecycle class, compat ⚠️ (row "A run's lifecycle and exit status", measured in `reference/isolate-host-sandbox-lifecycle-class.md`). Owner: runtime-js. Trigger: primordials for the runtime's post-guest paths, or a guest found breaking its own status this way.

Sandbox capture path (PR #424 cross-review round 2): the end state is captured in the guest's
realm after the run's status is out, through the codec's `DataView` writes and the FS walk, so a
guest that replaced those intrinsics runs its own code there and can leave any tree the codec
accepts (`setUint16` turning `a` into `b`: `/workspbce`, exit 0, no `stateRefused`) or hang the
run (`timeout`, rolled back); its output there is dropped. That path is the goal unit
`distribution/isolate-host-sandbox-capture-outside-guest-realm`.

Measured in the isolate host (ADR-0557) @ 2cbb37c50, each against `node -e`:
`Map.prototype.get = () => { throw new Error('boom') }; console.log(1)` → the
run never drains (`termination: 'timeout'`), Node exits 0;
`Function.prototype.bind` poisoned → exit 1, Node 0;
`Object.defineProperty(Promise.prototype, 'constructor', { get() { throw … } }); console.log(1)`
→ exit 1, Node 0; `process.emit` throwing → exit 1, Node 7. Also measured @ b9ff5be73:
`Number.isInteger = () => false`, `Reflect.get = () => undefined` and
`Object.assign = () => { throw … }` each turn a clean run into exit 1 (Node 0),
and a `Reflect.get` that forges the lifecycle slot makes a throwing run exit 0.
@ 1d3fc3c43: `Promise.prototype.constructor = 0; Promise.prototype.then = (f) => f(); setTimeout(() => process.exit(2), 20)`
→ exit 1 (`TypeError: The .constructor property is not an object`), Node 2;
`Reflect.get = () => undefined; console.log(1)` → exit 1 with the runtime's
`Error: process.exit(0)` stack in stderr, Node 0 with empty stderr.
@ 937595c70 (v24.16.0): `Map.prototype.get = () => { throw new Error('boom') }; console.log(1)`
→ exit 1, `Error: boom … at process.emit (rifty-isolate-guest.js:…)`, Node 0
(the `undefined`-returning variant hung in the host's own timer table, since
captured); `Function.prototype.bind = function () { throw new Error('b') }; console.log(1)`
→ exit 1 at `keepaliveState`, Node 0; `setTimeout((a) => { process.stdout.write(String(a) + '\n') }, 5, 'arg'); Array.prototype[Symbol.iterator] = function* () {}`
→ prints `undefined`, Node `arg` (the runtime timer wrapper spreads its
arguments). The isolate host's own tail keeps only the captures that hold
measured cases (ADR-0557 §6); these are the runtime's paths,
shared with the browser realms. Parts of
runtime-js already capture primordials (`reflectApplyPrimordial` in
`module-loader`, `process.ts`); the lifecycle modules do not. A guest hanging
its own run is bounded by the deadline (I4); what is not accepted is a wrong
status where Node has a right one (manager decision 2026-11-18, ADR-0557 §Not the user's words: an open,
declared fidelity class until this lands).

Same class, every host (2026-11-24, PR #436 external review; `runCode`,
Node v24.16.0): `os.availableParallelism()`/`os.cpus()` read the live
`navigator.hardwareConcurrency` (`builtins/os.ts`), which guest code can
replace (`globalThis.navigator`, or a getter redefined on
`Navigator.prototype`). A throwing getter makes `os.availableParallelism()`
throw; a `-1` getter gives `-1` and `os.cpus().length` 0 (Node `12 12`, its
`os` reads the binding); `5e6` ends the run `termination: 'memory'`. On the
browser hosts the same read hits the browser's `WorkerNavigator`.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)

Isolate guest `TextDecoder` engine (ADR-0577, 2026-11-25, PR #459 critic): @exodus/bytes, which
decodes utf-16le/be and gb18030 there (Node: C++ ICU), reads live intrinsics on every call:
`String.fromCharCode = () => 'X'` → `new TextDecoder('utf-16le').decode(Uint8Array.of(0x41, 0))`
is `'X'` (Node `'A'`); a replaced `%TypedArray%.prototype.subarray` or `length` getter changes or
empties the result; `Object.defineProperty` replaced before the first such decoder makes its
constructor throw the guest's error. Node's own `encoding.js` and the utf-8 codec run on intrinsics
captured at load.

