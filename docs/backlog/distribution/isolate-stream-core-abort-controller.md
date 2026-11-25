---
area: distribution
status: draft
title: The isolate guest's stream core gets Node's AbortController/AbortSignal from Node's sources, so Node's pipeline and helpers keep working
created: 2026-11-25
why: Node's pipeline creates an AbortController per call and passes its signal to function stages; AbortController/AbortSignal are ceiling globals in the isolate guest, and rifty's pipeline works there today
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/map.md]
---

## Context

Unit 7 of goal node-streams-as-in-node (map), ADR-0575 §6.

Why it is needed:
- `lib/internal/streams/pipeline.js:195` creates `new AbortController()` on every call;
- `operators.js:65,252` pass `{ signal }` to user functions;
- `web-shim.ts:355` lists `AbortController`/`AbortSignal`/`EventTarget`/`Event` as isolate ceilings;
- on the product build, the isolate gives `m7` 5/11 and `AbortController2 is not a constructor`
  (`results/route-b-product-programs.txt`).

The sources: Node's `internal/abort_controller.js` + `event_target.js` + `webidl.js`, about 31 KB min /
9 KB gzip (`results/route-b-size.txt`). They need stubs for `internalBinding('messaging')`, and the
`MessageChannel` transfer path becomes a named gap.

The fact, not a security property: without being globals, the classes stay reachable.
- `signal.constructor` is `AbortSignal` with its statics (`signal.constructor.any([])` makes a signal);
- `Object.getPrototypeOf(AbortSignal.prototype).constructor` is a working `EventTarget`;
- an event's `constructor` is `Event`;
- the globals stay ceiling throws, so `signal instanceof AbortSignal` throws.

This unit comes before 8c: the isolate's pipeline rows need it, and `pipeline` works there today.
The user's answer decides only the globals.

Open fork — owner: user, carried with the isolate Web API goal's question 1:
- (a) keep the classes unreachable as globals (as above);
- (b) make `AbortController`/`AbortSignal`/`EventTarget`/`Event` isolate globals from the same sources.

The bytes are the same either way.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
