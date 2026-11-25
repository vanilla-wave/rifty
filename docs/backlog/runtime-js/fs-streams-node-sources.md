---
area: runtime-js
status: draft
title: fs.ReadStream and fs.WriteStream are Node v24.16.0's lib/internal/fs/streams.js over the core, reading and writing through fds on every host
created: 2026-11-25
why: Today's fs streams are hand-written EventEmitters (no for await, a late listener reads nothing, graceful-fs throws); Node's streams.js over route B's core equals Node on 18/22 and 13/14 matrix rows, the rest bindings
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/reference/results/m4-readstream.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/m5-writestream.txt]
---

## Context

Unit 9 of goal node-streams-as-in-node; contract and acceptance: map item 9, ADR-0575 §3. Stands on
units 8, 4, 5. Absorbs 5 drafts and PRs #434/#437 (map §Links). Its acceptance also holds the fs-stream rows of `m2`/`m3`
and the carrier = Node on every host (I8). The fd source reads on every column
measured today (`m4` «Node's ReadStream source»); Chromium/OPFS cost and the unlink-during-read
semantics are map §Open questions.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
