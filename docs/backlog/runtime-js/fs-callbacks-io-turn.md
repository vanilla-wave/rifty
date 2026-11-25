---
area: runtime-js
status: draft
title: fs callback APIs complete in an I/O turn, so timers interleave with them as in Node
created: 2026-11-25
why: rifty's fs.read/fs.write call back through a Promise microtask chain, so a read loop starves timers (0 ticks over 16 MiB, Node > 0)
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/m4-readstream.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-parity-fs-streams.txt]
---

## Context

Unit 4 of goal node-streams-as-in-node (map), a binding of verbatim fs streams (ADR-0575).
`m4` row «timers run during an fs.read(fd) loop over 16 MiB»: Node `ticks>0=true`, rifty `false` on
every column (`fs.ts` callbacks are `Promise.resolve().then(...)`). A write issued before close lands
on main already (`b1`, fs-stream parity A 6/6); the route-B fs rows that lost it were a probe
artefact (product bindings 6/6), so they are a guard row here.
It changes every callback API of `fs` (read, write, open, close, stat, readFile, …), so it carries a
regression row of its own: `cases/fs` parity plus an ordering case against timers and `setImmediate`.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
