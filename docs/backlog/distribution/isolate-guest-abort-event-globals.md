---
area: distribution
status: draft
title: "`AbortController`, `AbortSignal`, `EventTarget` and `Event` are the isolate guest's globals, Node's own classes, and Node's `signal` APIs work in the guest"
created: 2026-11-25
why: the four are ceiling throwers in the isolate guest; every Node API taking a `signal` stops at `isolate-host.AbortController`, and `AbortSignal.timeout` is `TypeError: … is not a function`
epic: isolate-guest-web-api
sources: [docs/backlog/epics/isolate-guest-web-api/reference/today/README.md, docs/backlog/epics/isolate-guest-web-api/reference/sources-js/README.md]
code: [packages/isolate-guest/src/guest/web-shim.ts]
---

## Context

The user chose (2026-11-25, via the manager) the four as ordinary guest globals from Node's
sources. The classes come from goal `node-streams-as-in-node` unit 7
(`distribution/isolate-stream-core-abort-controller`, branch `t3/node-streams-goal`); this unit
removes them from `CEILING_GLOBALS`, defines them as globals before guest code, and carries goal
`isolate-guest-web-api` I3's rows: Node's WPT `test/wpt/test-abort.js`/`test-events.js` as Node's
`status/` records (minus `MessageChannel`/GC tests, listed here when compiled), the statics, and
Node's `signal` APIs (`events.once`/`on`, `timers/promises`, `fs.readFile`, `fs.promises.readFile`).

Today (`reference/today`, main bc3412420, Node v24.16.0): `new AbortController()`,
`new EventTarget()`, `new Event('x')` → named gaps; `AbortSignal.abort`/`timeout`/`any` →
`TypeError: … is not a function`; the `signal` APIs → `isolate-host.AbortController`; no load-time
reads (`results-trace-load.txt`). Source (`reference/sources-js`): Node's files verbatim, 0/31 cases
differ in a bare isolate. `CustomEvent`: goal map question M1.
