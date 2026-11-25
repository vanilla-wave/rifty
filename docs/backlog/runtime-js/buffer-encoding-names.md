---
area: runtime-js
status: ready
title: Buffer accepts every encoding spelling Node's normalizeEncoding maps, in every Buffer API
created: 2026-11-25
why: Buffer.isEncoding('UTF8') is true but Buffer.from/toString with 'UTF8', 'UCS2', 'LATIN1', 'BINARY', 'BASE64', 'HEX', 'ASCII' throw 'Unsupported encoding' in rifty, where Node maps them case-insensitively; and rifty decodes base64/base64url/hex input outside the alphabet differently from Node (Buffer.from('Aé', 'base64') is empty in Node, throws InvalidCharacterError in rifty)
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-parity-stream.txt]
---

## Context

Unit 2 of goal `node-streams-as-in-node` (map).

Today, `docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt`:
- `Buffer.isEncoding` is true for every spelling;
- `buf.toString(name)` and `Buffer.from(str, name)` throw `Unsupported encoding` for every upper- or
  mixed-case spelling (`packages/io/src/buffer-codec.ts:68`).

The same row also shows a parsing difference that is not about names. `Buffer.from('Aé', name)`:
Node gives an empty buffer for `base64`, `base64url` and `hex`; rifty throws
`DOMException InvalidCharacterError` for `base64`/`base64url` (`atob`,
`packages/io/src/buffer-codec.ts:62-63`) and gives `0a` for `hex` (`parseInt` per pair, `:55-59`). The
`b1` row labels an error (`threw <class> <code>: <message>`), so it cannot read as a value. This unit fixes it too,
because the acceptance row covers it and the code is the same codec.

Node maps names through `normalizeEncoding` (`lib/internal/util.js`). On route B, parity
`stream/writable-admission` fails on `'UTF8'`.

## Challenge

challenge: 2026-11-25 — clear (premise in goal §Challenge)

## Acceptance

1. `b1` rows «buf.toString(name)» and «Buffer.from(str, name)» = Node for all 24 names, on in-process, isolate, Workbench and SDK, including the empty buffers Node gives for `Buffer.from('Aé', 'base64' | 'base64url' | 'hex')`. → I9
2. `b1` row «Buffer.isEncoding» stays = Node (guard). → I9

## Parity cases

1. A new `tools/node-parity-runner/cases/buffer/encoding-names.case.ts`. Names: every name Node's `normalizeEncoding` accepts (case variants, `utf-8`, `ucs-2`, `utf-16le`, `binary`, the empty string) plus a few it rejects. Entry points: every Buffer entry point that takes an encoding (`from`, `toString`, `write`, `fill`, `byteLength`, `indexOf`/`lastIndexOf`/`includes`, `Buffer.alloc(n, fill, enc)`), and `Buffer.concat` of the results. Each row prints bytes or text, or the error class, `code` and message. → I9
2. A new `tools/node-parity-runner/cases/buffer/decode-invalid-input.case.ts`: `Buffer.from(s, enc)` and `byteLength(s, enc)` for `base64`, `base64url` and `hex` with characters outside the alphabet, whitespace, padding in the middle, odd hex length and a non-hex pair. Each row prints the bytes, or the error labelled with its class and `code` (never printed like a value). → I9

## Out of scope

- New encodings Node lacks.
- `TextDecoder` labels: they follow WHATWG, not Node's names.

## Decisions

- One normalisation point in `@riftydev/io`'s buffer codec, holding Node's `normalizeEncoding` table
  and its slow path. Every entry point calls it, and so does `string_decoder` (unit 1 comes after this).
- base64/base64url/hex decoding of input outside the alphabet follows Node, as the parity case above
  pins it; it is in this unit, not a separate draft.
