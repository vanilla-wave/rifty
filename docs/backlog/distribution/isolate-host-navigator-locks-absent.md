---
area: distribution
status: draft
title: In the isolate guest navigator.locks is silently undefined where Node 24 has a LockManager
created: 2026-11-24
why: Node 24's `navigator` has `locks` (`require('worker_threads').locks === navigator.locks`); the guest's `navigator` lists five members, not `locks`, so `navigator.locks` reads `undefined` with no named gap
sources: [docs/backlog/distribution/isolate-host-ceiling-modules-load.md, ADR-0557]
code: [packages/isolate-guest/src/guest/web-shim.ts]
---

## Context

Found while delivering `distribution/isolate-host-ceiling-modules-load`. 2026-11-24:
`node -e "console.log(typeof navigator.locks)"` (v24.16.0) → `object`; `Object.getOwnPropertyNames(
Object.getPrototypeOf(navigator))` lists `locks`. Isolate `runCode` of the same → `undefined`;
`Object.keys(navigator)` → `hardwareConcurrency, language, languages, platform, userAgent`
(`NAVIGATOR_MEMBERS`, `web-shim.ts`, each a loud getter). compat `isolate-host.md` declares
"`Navigator` and `navigator.*`" ❌ (`NotImplementedError`), so `locks` is an undeclared silent
`undefined`. The guest's `worker_threads.locks` (unit above) is a `LockManager`-shaped object whose
members are named gaps; it is not `navigator.locks`.
