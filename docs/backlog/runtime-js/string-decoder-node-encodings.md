---
area: runtime-js
status: ready
title: string_decoder decodes every encoding Node's does and rejects an unknown one with ERR_UNKNOWN_ENCODING
created: 2026-11-25
why: rifty's StringDecoder throws NotImplementedError for every encoding but utf8 (latin1, ucs2/utf16le, base64, hex, ascii) and for an unknown name, where Node decodes or throws ERR_UNKNOWN_ENCODING; Node's stream core (setEncoding, the encoding option) decodes through it
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-parity-stream.txt]
---

## Context

Unit 1 of goal `node-streams-as-in-node` (map). It is a parity fix on its own, and the verbatim
stream core decodes through it (ADR-0575 §2).

Today, `docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt` row «new StringDecoder(name).write+end per name»:
- Node decodes all 22 spellings and rejects `'nope'` with `ERR_UNKNOWN_ENCODING`;
- rifty decodes only the utf8 spellings and throws `NotImplementedError` for every other encoding,
  base64 and hex included.

On route B every non-utf8 `encoding` option of `fs.createReadStream` would therefore throw
(`docs/backlog/epics/node-streams-as-in-node/reference/results/m4-readstream.txt` «encoding option through 'data'»). Today's hand-written ReadStream decodes
base64, latin1 and hex as Node does. So this unit lands before unit 8.

Names: `packages/runtime-js/src/builtins/string_decoder.ts:26` normalises names itself
(`toLowerCase().replace('-', '')`). Node's `string_decoder` uses the same `normalizeEncoding` as
`Buffer`. So this unit uses unit 2's single normalisation point in `@riftydev/io`'s buffer codec, and
comes after unit 2 (edge 1 ← 2).

It also closes the string_decoder row of `runtime-js/node-builtins-loud-stub-capability-gaps`.

## Challenge

challenge: 2026-11-25 — clear (premise in goal §Challenge)

## Acceptance

1. `b1` row «new StringDecoder(name).write+end per name» = Node on in-process, isolate, Workbench and SDK: all 22 spellings, and `'nope'` → `ERR_UNKNOWN_ENCODING` with Node's message. → I9
2. `m8` «options encoding "nope"» stays = Node (`ERR_UNKNOWN_ENCODING` from Readable, Duplex and Transform). → I9
3. `Readable#setEncoding` names go through `normalizeEncoding` (the `ENCODINGS` table in `packages/io/src/streams/readable.ts` goes): `setEncoding('')`, `setEncoding(null)`, `setEncoding(undefined)` → Node `readableEncoding` `'utf8'`, rifty `ERR_UNKNOWN_ENCODING` today; `setEncoding('__proto__')`, `setEncoding('constructor')` → Node `ERR_UNKNOWN_ENCODING`, rifty accepts (prototype key of the table, `readableEncoding` `null`). Node v24.16.0 vs `@riftydev/io`, 2026-11-25 (PR #456 review). → I9

## Parity cases

1. A new `tools/node-parity-runner/cases/string_decoder/encodings-split.case.ts`. It covers every encoding Node accepts: utf8, utf16le/ucs2, latin1/binary, base64, base64url, hex, ascii, in every spelling `normalizeEncoding` maps. Bytes are fed in every split from 1 to N, and it records `write`, `end` and `text` for each chunk. It includes surrogate pairs split across writes, base64 carries, and an odd trailing hex or utf16le byte. → I9
2. The same case covers `new StringDecoder('nope')` and `new StringDecoder(1)`: error class, `code` and message. → I9
3. The repro rows of `readable-set-encoding-string-decoder-residue` that need only the decoder: base64, utf16le, tail decode. → I9

## Out of scope

- The stream `setEncoding` mechanism: that is Node's `readable.js`, in unit 8. The `m4` rows «setEncoding utf8, highWaterMark 5» and «encoding option through 'data'» differ from Node today on every column and go green only with 9r; they are 9r's rows.
- Encodings Node does not accept: they stay `ERR_UNKNOWN_ENCODING`.

## Decisions

- The semantics are those of Node's `lib/string_decoder.js` and `src/string_decoder.cc`. This is a
  port of behaviour, proven by the parity case above; no native code is copied.
- Names go through unit 2's normalisation point, not a second table in `string_decoder.ts`.
