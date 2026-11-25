---
area: distribution
status: draft
title: The isolate guest's stream core has Node's AbortController/AbortSignal privately, so Node's pipeline and helpers keep working
created: 2026-11-25
why: Node's pipeline creates an AbortController per call and passes its signal to function stages; AbortController/AbortSignal are ceiling globals in the isolate guest, and rifty's pipeline works there today
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/map.md]
---

## Context

Unit 7 of goal node-streams-as-in-node (map), ADR-0575 §6. `lib/internal/streams/pipeline.js:195`
`new AbortController()` per call; `operators.js:65,252` pass `{ signal }` to user functions; `web-shim.ts:355`
lists `AbortController`/`AbortSignal`/`EventTarget`/`Event` as isolate ceilings. Measured route and cost:
map §Open questions. No new guest global (the Web API goal's question 1 stays open).

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
