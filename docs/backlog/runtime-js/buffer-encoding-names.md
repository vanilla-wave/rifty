---
area: runtime-js
status: draft
title: Buffer accepts every encoding spelling Node's normalizeEncoding maps, in every Buffer API
created: 2026-11-25
why: Buffer.isEncoding('UTF8') is true but Buffer.from/toString with 'UTF8', 'UCS2', 'LATIN1', 'BINARY', 'BASE64', 'HEX', 'ASCII' throw 'Unsupported encoding' in rifty; Node maps them case-insensitively
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-parity-stream.txt]
---

## Context

Unit 2 of goal node-streams-as-in-node (map), a binding of the verbatim stream core (ADR-0575).
`b1` rows «buf.toString(name)» and «Buffer.from(str, name)»: every upper- or mixed-case spelling throws
`Unsupported encoding` (`packages/io/src/buffer-codec.ts:68`), while `isEncoding` says true. On route B,
parity `writable-admission` fails on `'UTF8'`. Scope: Node's `normalizeEncoding`
(`lib/internal/util.js`) applied in every Buffer entry point (`from`, `toString`, `write`, `fill`,
`byteLength`, `indexOf`/`includes`, `compare` paths taking an encoding).

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
