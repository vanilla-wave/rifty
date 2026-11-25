---
area: runtime-js
status: draft
title: string_decoder decodes every encoding Node's does and rejects an unknown one with ERR_UNKNOWN_ENCODING
created: 2026-11-25
why: rifty's StringDecoder throws NotImplementedError for every encoding but utf8 (latin1, ucs2/utf16le, base64, hex, ascii) and for an unknown name, where Node decodes or throws ERR_UNKNOWN_ENCODING; Node's stream core (setEncoding, the encoding option) decodes through it
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/b1-bindings.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-parity-stream.txt]
---

## Context

Unit 1 of goal node-streams-as-in-node (map), a binding of the verbatim stream core (ADR-0575).
`b1` row «new StringDecoder(name).write+end per name»: Node decodes all 22 spellings and throws on
`'nope'`; rifty decodes the utf8 spellings only (`Not implemented` for every other encoding, base64/hex included).
`m4` row «encoding option through 'data'» (B2):
- today's hand-written ReadStream decodes base64/latin1/hex as Node does in-process, and splits a
  utf16le surrogate (`Ā�|�!`);
- on route B every non-utf8 encoding throws `NotImplementedError: string_decoder encoding …`.

So this unit lands before unit 9: without it, route B breaks working reads.
On route B, parity `readable-set-encoding-latin1` and `-bom` fail on it (`string_decoder encoding
'latin1'`/`'utf16le'`), and so does `m8` «encoding nope». Overlaps `runtime-js/node-builtins-loud-stub-capability-gaps` (its string_decoder row): this unit
closes that row. Scope: Node's `lib/string_decoder.js`
semantics for every encoding, chunk-split code points and surrogates (`readable-set-encoding-string-decoder-residue`'s rows).

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
