---
area: runtime-js
status: draft
title: fs.ReadStream is Node v24.16.0's from lib/internal/fs/streams.js over the core, reading by fd on every host
created: 2026-11-25
why: Today's fs.ReadStream is a hand-written EventEmitter (no for await, a late listener reads nothing, isolate fails at the first read); Node's over route B's core equals Node on the read rows
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/reference/results/m4-readstream.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-9r/c-for-await.txt]
---

## Context

Unit 9r (map). Stands on 8 (8a–8c), 4, 4b. The file holds both classes; it is loaded whole and only
`ReadStream`/`createReadStream` are wired, `fs.WriteStream` stays today's class until 9w. Measured
in-process (product bindings, today's WriteStream): carrier 8/10 programs = Node; the two left
(`c-graceful-fs`, `c-unzip-stored`) fail on today's write class exactly as today; `c-transform-big`
through today's WriteStream keeps Node's backpressure (in-flight 65536) (`results/route-b-9r/`).
Acceptance: `m4` and the read rows of `m2`/`m3` = Node on every host; carrier read programs = Node;
PR #437's cases; the isolate `ReadableStream` wall gone (absorbs #437, conditional).

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
