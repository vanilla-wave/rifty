---
area: runtime-js
status: draft
title: pipeline and stream/promises.pipeline accept function and async-generator stages, and their success callbacks get Node's arguments
created: 2026-11-25
why: rifty's pipeline rejects every non-stream stage with a TypeError, so `pipeline(src, async function* …, dst)` and generator sources and sinks fail. Its and finished's success callbacks get `null` where Node passes `undefined` or no argument.
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/m7-pipeline-stages.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/c-pipeline-asyncgen.txt]
code: [packages/io/src/streams/pipeline.ts]
---

## Context

Unit 7 of the goal (I7). Node's `pipeline` (`lib/internal/streams/pipeline.js:295-306`) turns a
function stage into a stage over the previous iterable: a source, a transform, or a sink whose return
value is the promise's value. Main `b6d37fc01` (`m7`) gives 0 of 7 rows equal on every rifty column.

- Every generator or function stage throws `pipeline: argument must be a stream (index N received a
  non-stream value)`.
- An async function sink does not settle.
- A success callback gets `cb(null)` (Node `cb(undefined, undefined)`), and `finished` gets 1
  argument (Node 0).

It does not depend on the fs units. The carrier case puts `fs` streams around it.

Absorbs `stream-pipeline-finished-callback-args` and the branch-only
`stream-pipeline-callback-generator-stage` (PR #437 local commit `397555c3d`).

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
