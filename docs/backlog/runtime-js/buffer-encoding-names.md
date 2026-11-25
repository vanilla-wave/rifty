---
area: runtime-js
status: ready
title: Buffer accepts every encoding spelling Node's normalizeEncoding maps, in every Buffer API
created: 2026-11-25
why: Buffer.isEncoding('UTF8') is true but Buffer.from/toString with 'UTF8', 'UCS2', 'LATIN1', 'BINARY', 'BASE64', 'HEX', 'ASCII' throw 'Unsupported encoding' in rifty; Node maps them case-insensitively
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-parity-stream.txt]
---

## Context

Unit 2 of goal `node-streams-as-in-node` (map).

Today, `docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt`:
- `Buffer.isEncoding` is true for every spelling;
- `buf.toString(name)` and `Buffer.from(str, name)` throw `Unsupported encoding` for every upper- or
  mixed-case spelling (`packages/io/src/buffer-codec.ts:68`).

Node maps names through `normalizeEncoding` (`lib/internal/util.js`). On route B, parity
`stream/writable-admission` fails on `'UTF8'`.

## Challenge

challenge: 2026-11-25 — clear (premise in goal §Challenge)

## Acceptance

1. `b1` rows «buf.toString(name)» and «Buffer.from(str, name)» = Node for all 24 names, on in-process, isolate, Workbench and SDK. → I9
2. `b1` row «Buffer.isEncoding» stays = Node (guard). → I9

## Parity cases

1. A new `tools/node-parity-runner/cases/buffer/encoding-names.case.ts`.; Names: every name Node's `normalizeEncoding` accepts (case variants, `utf-8`, `ucs-2`, `utf-16le`, `binary`, the empty string) plus a few it rejects.; Entry points: every Buffer entry point that takes an encoding (`from`, `toString`, `write`, `fill`, `byteLength`, `indexOf`/`lastIndexOf`/`includes`, `Buffer.alloc(n, fill, enc)`), and `Buffer.concat` of the results.; Each row prints bytes or text, or the error class, `code` and message. → I9

## Out of scope

- New encodings Node lacks.
- `TextDecoder` labels: they follow WHATWG, not Node's names.

## Decisions

- One normalisation point in `@riftydev/io`'s buffer codec, holding Node's `normalizeEncoding` table
  and its slow path. Every entry point calls it.
