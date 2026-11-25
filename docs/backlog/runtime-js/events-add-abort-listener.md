---
area: runtime-js
status: draft
title: events.addAbortListener exists and behaves as Node's
created: 2026-11-25
why: rifty's node:events has no addAbortListener; Node's stream core (end-of-stream, add-abort-signal) imports it
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-bindings.txt]
---

## Context

Unit 3 of goal node-streams-as-in-node (map), a binding of the verbatim stream core (ADR-0575).
`b1` row «events.addAbortListener»: Node `typeof=function`, listener runs on abort, returns a
`Disposable`; rifty `typeof=undefined`. It is the only `events` member the verbatim core needs that
rifty lacks (`route-b-bindings.txt`). Scope: Node's `lib/internal/events/abort_listener.js` behaviour
(already-aborted signal, disposal). `kResistStopPropagation` has no effect on a host `EventTarget`, a
named gap of the bindings (ADR-0575 §2): this unit measures whether a listener that stops
propagation can then hide the abort from the core, against Node.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
