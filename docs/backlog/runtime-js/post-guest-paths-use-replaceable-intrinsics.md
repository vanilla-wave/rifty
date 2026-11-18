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
and a `Reflect.get` that forges the lifecycle slot makes a throwing run exit 0. The isolate host's
own tail is primordial-only (ADR-0557 §5), so these are the runtime's paths,
shared with the browser realms. Parts of runtime-js already capture
primordials (`reflectApplyPrimordial` in `module-loader`, `process.ts`); the
lifecycle modules do not. A guest hanging its own run is accepted
(`goal.md` Decisions: breaking its own rifty is the guest's business) — what is
not is a wrong status where Node has a right one.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
