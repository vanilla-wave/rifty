---
area: runtime-js
status: draft
title: Runtime lifecycle work after guest code uses guest-replaceable intrinsics
created: 2026-11-18
why: The drain, keepalive and exit paths call `Map.prototype.get`, `Function.prototype.bind`, `Promise.prototype.constructor` and `process.emit` through the live globals, so guest code can change or hang its own run's outcome.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/timers.ts, packages/runtime-js/src/builtins/process-lifecycle-events.ts]
---

## Context

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
`Error: process.exit(0)` stack in stderr, Node 0 with empty stderr. Since the
next commit the isolate host's own tail (bundle chaining, status transport,
child) uses captured `then`, index loops and a primitive status (ADR-0557 §6),
so what remains is the runtime's paths, shared with the browser realms. Parts of
runtime-js already capture primordials (`reflectApplyPrimordial` in
`module-loader`, `process.ts`); the lifecycle modules do not. A guest hanging
its own run is bounded by the deadline (I4); what is not accepted is a wrong
status where Node has a right one (ADR-0557 §Corrections 2026-11-18: an open,
declared fidelity class until this lands).

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
