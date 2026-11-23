---
area: runtime-js
status: draft
title: util.inspect default format — classes as functions
created: 2026-11-18
why: Node's default inspect prints `[class A]`; rifty's inspector (console, util.inspect, -p) prints `[Function: A]`.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/repl/inspect.ts]
---

## Context

`node -e "console.log({ get g() { return 1 } }, class A {}, [1, , 3], new Array(3))"`
→ Node v24.16.0 `{ g: [Getter] } [class A] [ 1, <1 empty item>, 3 ] [ <3 empty items> ]`;
rifty (isolate host, ADR-0557; same inspector in the browser realms)
`{ g: 1 } [Function: A] [ 1, , 3 ] [ , ,  ]`. Calling the getter is also an
observable side effect Node does not perform. Found by the PR #405
cross-review. Neighbour, not duplicate: `runtime-js/util-surface-completions`
owns inspect *options* (depth, breakLength, getters: true, …) and the
typed-array / grouping layout gaps; these three are default-format defects.

2026-11-22 — getters (`[Getter]`, never run) and holes (`<N empty items>`)
fixed in PR #421 (`repl/inspect.ts`); the class form remains.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
