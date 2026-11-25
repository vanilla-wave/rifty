---
area: runtime-js
status: draft
title: fs.writev, fs.fsync, fs.fdatasync and their Sync forms exist as in Node
created: 2026-11-25
why: rifty's fs has no writev/fsync/fdatasync: Node's fs.WriteStream then sets _writev = null, and flush: true has nothing to call
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/m5-writestream.txt]
---

## Context

Unit 5 of goal node-streams-as-in-node (map), a binding of verbatim fs streams (ADR-0575).
`b1` row «fs.writev / fs.fsync …»: Node `function` ×5, rifty `undefined` ×5. Route B `m5` «member
types»: `_writev:object` (null) where Node has `function`. Scope: callback and Sync forms, the
`position` argument of `writev`, `fsync` on each VFS backend (OPFS: the durable-or-throw flush, trap
`write-ack-not-durable`).

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
