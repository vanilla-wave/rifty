---
area: runtime-js
status: draft
title: Regression rows for every internal stream consumer and non-stream object stream code meets are in CI, green on today's core
created: 2026-11-25
why: Second core unit of goal node-streams-as-in-node (8b): the wiring (8c) must not regress internal consumers, and today's lanes miss their destroy/error paths and the non-stream objects Node's stream functions reject
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/map.md, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-s5-consumers.txt]
---

## Context

Unit 8b (map item 8b). Rows, each green on today's core before 8c: per internal stream kind (child stdio,
worker stdio, `process-file-stdout`, `worker-stdin-writer`, `child_process-exec`, no-COI stdin,
`IncomingMessage`, `Gzip` with its own `destroy()`), one normal completion and one error/destroy;
Node `pipe`/`pipeline`/`finished` into `ServerResponse`, `ClientRequest`, `PortRegistrySocket`,
`process.stdout` and the upgrade socket, success and error. Measured on route B
(`route-b-s5-consumers.txt`): `finished(req.socket)` throws `ERR_INVALID_ARG_TYPE` where today and Node
accept; a source piped into an unread `ServerResponse` reads 2001 chunks (Node 56–96, today 8). 8c
closes both without converting `net.Socket`/`ServerResponse` into real streams. Not yet measured on
route B: `ClientRequest`, `process.stdout` (parity `stream/pipe-process-stdio*`), the upgrade socket.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
