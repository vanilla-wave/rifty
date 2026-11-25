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

It also closes the string_decoder row of `runtime-js/node-builtins-loud-stub-capability-gaps`.

## Challenge

challenge: 2026-11-25 — clear (premise in goal §Challenge)

## Acceptance

1. `b1` row «new StringDecoder(name).write+end per name» = Node on in-process, isolate, Workbench and SDK: all 22 spellings, and `'nope'` → `ERR_UNKNOWN_ENCODING` with Node's message. → I9
2. Guard rows stay = Node: `m4` «setEncoding utf8, highWaterMark 5» and «encoding option through 'data'». → I9
3. `m8` «options encoding "nope"» stays = Node (`ERR_UNKNOWN_ENCODING` from Readable, Duplex and Transform). → I9

## Parity cases

1. A new `tools/node-parity-runner/cases/string_decoder/encodings-split.case.ts`.; It covers every encoding Node accepts: utf8, utf16le/ucs2, latin1/binary, base64, base64url, hex, ascii.; Bytes are fed in every split from 1 to N; it records `write`, `end` and `text` for each chunk.; It includes surrogate pairs split across writes, base64 carries, and an odd trailing hex or utf16le byte. → I9
2. The same case covers `new StringDecoder('nope')` and `new StringDecoder(1)`: error class, `code` and message. → I9
3. The repro rows of `readable-set-encoding-string-decoder-residue` that need only the decoder: base64, utf16le, tail decode. → I9

## Out of scope

- The stream `setEncoding` mechanism: that is Node's `readable.js`, in unit 8.
- Encodings Node does not accept: they stay `ERR_UNKNOWN_ENCODING`.

## Decisions

- The semantics are those of Node's `lib/string_decoder.js` and `src/string_decoder.cc`. This is a
  port of behaviour, proven by the parity case above; no native code is copied.
