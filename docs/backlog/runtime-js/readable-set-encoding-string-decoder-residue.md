---
area: runtime-js
status: draft
title: Readable#setEncoding decodes base64, utf16le and the stream tail like StringDecoder
created: 2026-11-17
why: setEncoding('base64') emits padded per-chunk base64 (wrong concatenation), utf16le replaces lone surrogates, and a truncated utf8 tail is dropped
sources: [docs/adr/runtime-js/0069-readable-set-encoding.md]
code: [packages/io/src/streams/readable.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17), same table as
ADR-0069 D3 (BOM and latin1 fixed there). Probe (scratch parity case,
`new Readable({ read() {} })`, `setEncoding(enc)`, pushed chunks, Node v24.16.0
vs rifty, data chunks as code points):

| enc, chunks | Node | rifty |
|---|---|---|
| base64, `[61]` `[62 63 64]` | `YWJj`, `ZA==` | `YQ==`, `YmNk` (joined text is not base64 of the bytes) |
| utf16le, `[00 d8 41 00]` | `d800 41` | `fffd 41` |
| utf8, `[41 e2 82]` then end | `41`, `fffd` | `41` |

Cause: `hex`/`base64`/`base64url` decode per chunk with no carry (Node's
StringDecoder keeps `len % 3` bytes); utf16le goes through `TextDecoder`
(replaces unpaired surrogates); the decoder is never flushed at end — the last
one is the "documented minor deviation" in ADR-0069 D3. hex is per-byte, so
correct. Fault: corrupt-input (lossy/misframed decode) at setEncoding.
Dedup: git grep setEncoding / base64 / StringDecoder over docs/backlog — no item.

## Next

Owner runtime-js; trigger: a claimed consumer reading a stream with
`setEncoding('base64')` (e.g. body → base64 upload) or utf16le text. RED first:
the three rows above as a `stream/readable-set-encoding-residue` parity case.
