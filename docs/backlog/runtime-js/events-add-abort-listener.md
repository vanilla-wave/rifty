---
area: runtime-js
status: ready
title: events.addAbortListener exists and behaves as Node's
created: 2026-11-25
why: rifty's node:events has no addAbortListener for guest code (Node has it since v20.5); the verbatim stream core does not need it, it carries Node's own internal/events/abort_listener
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-bindings.txt]
---

## Context

Unit 3 of goal `node-streams-as-in-node` (map). It is guest public API only and has no edge in
`docs/backlog/epics/node-streams-as-in-node/reference/results/ownership.txt`. The verbatim stream core does not read this export: in the probe it carries Node's own
`internal/events/abort_listener` (variant A; the variant is `runtime-js/stream-core-abort-listeners-host-event-target`'s), ADR-0575 §2.

Today, `docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt` row «events.addAbortListener»:
- Node: `typeof=function`, the listener runs on abort, the return value is a `Disposable`;
- rifty: `typeof=undefined`.

## Challenge

challenge: 2026-11-25 — clear (premise in goal §Challenge)

## Acceptance

1. `b1` row «events.addAbortListener» = Node on in-process, Workbench and SDK. The isolate follows once a guest can make a signal, which is the Web API goal's. → I9
2. The compat matrix's `events` row lists `addAbortListener` as ⚠️ and names the difference on a host `EventTarget`: an earlier guest listener that calls `stopImmediatePropagation` hides the abort from it, where Node's still runs. → I9

## Parity cases

1. A new `tools/node-parity-runner/cases/events/add-abort-listener.case.ts`. Rows: an already-aborted signal: the listener runs in a microtask, after synchronous code; an abort after registration; `[Symbol.dispose]()` before the abort: the listener never runs; `signal` undefined → `ERR_INVALID_ARG_TYPE` with Node's message; a non-signal object → `ERR_INVALID_ARG_TYPE`; a non-function listener → `ERR_INVALID_ARG_TYPE`; what the listener sees: `this`, its arguments, `signal.reason`. → I9

## Out of scope

- `kResistStopPropagation` on a host `EventTarget`. Node's `addAbortListener` listener still runs
  after an earlier listener calls `stopImmediatePropagation`; on a host `EventTarget` it does not.
  This unit does not promise that row: it is a declared difference (compat ⚠️), owned by
  `runtime-js/stream-core-abort-listeners-host-event-target`.
- A guest `AbortController` in the isolate: the isolate Web API goal.

## Decisions

- Node's `lib/internal/events/abort_listener.js` semantics over the host `AbortSignal`, exported from
  `node:events`.
