---
area: runtime-js
status: draft
title: events.addAbortListener exists and behaves as Node's
created: 2026-11-25
why: rifty's node:events has no addAbortListener for guest code (Node has it since v20.5); the verbatim stream core does not need it, it carries Node's own internal/events/abort_listener
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-bindings.txt]
---

## Context

Unit 3 of goal node-streams-as-in-node (map). Guest public API only, independent of the core: the
generator puts Node's `internal/events/abort_listener` in whole (ADR-0575 §2).
`b1` row «events.addAbortListener»: Node `typeof=function`, listener runs on abort, returns a
`Disposable`; rifty `typeof=undefined`. Scope: Node's `lib/internal/events/abort_listener.js` behaviour
(already-aborted signal, disposal). `kResistStopPropagation` has no effect on a host `EventTarget`, a
named gap of the bindings (ADR-0575 §2): this unit measures whether a listener that stops
propagation can then hide the abort from the core, against Node.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
