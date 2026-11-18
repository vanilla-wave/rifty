---
area: runtime-js
status: draft
title: "node:zlib async inflate / inflateRaw / gunzip accept bytes after the compressed stream end as Node does"
created: 2026-11-18
why: Node returns the data when a zlib/raw stream is followed by extra bytes (a PDF FlateDecode slice keeping its EOL) and concatenates multi-member gzip; rifty's DecompressionStream backend rejects both, on compat rows marked ✅
user_story: As an agent decoding PDF FlateDecode streams, I want `await util.promisify(zlib.inflate)(slice)` on a slice cut up to `endstream` to return the content as in Node, but today it rejects with `TypeError: Junk found after end of compressed data.`
sources: [docs/adr/runtime-js/0159-node-zlib-web-compression-backed-async-subset.md, docs/public/compat/zlib.md, docs/backlog/runtime-js/reference/pr-403-final-green.json]
code: [packages/runtime-js/src/builtins/zlib.ts]
---

## Context

PR #403's Final+GREEN Ecosystem-UX concern
(`reference/pr-403-final-green.json`) concerns a ceiling hint. The hint "async
`zlib.inflate` works" points the pdf-t3 author (no-COI office-docs, 2026-11-12) at
a call that still fails. The pdf-t3 command slices
`b.subarray(start, s.indexOf('endstream'))`, which keeps the EOL. All 5
FlateDecode slices in its fixtures end in `\n`.

Node v24.16.0, `promisify(zlib.X)` and `XSync` (probe 2026-11-18):
- `inflate` / `inflateRaw` with a `\n`, CRLF, `JUNK!` or 8×`0x00` tail → OK with the data.
- `gunzip`:
  - `+'\n'` → `Z_BUF_ERROR` "unexpected end of file";
  - `+'JUNK!'` → `Z_DATA_ERROR` "incorrect header check";
  - `+8×0x00` → OK;
  - `gzip(a)+gzip(b)` → `a+b` (multi-member).
- pdf-t3 slices: async `inflate` decodes all 5.

Rifty @ 39cf60307. `runStream` (`zlib.ts:174`) passes the host stream error to
the callback, with no trailing-data handling:
- Chromium 148.0.7778.96 (bundled `zlib.ts` in a Playwright page):
  - every tail above, on `inflate`, `inflateRaw` and `gunzip` → `TypeError: Junk found after end of compressed data.` (no code);
  - a second gzip member → the same TypeError.
- tsx / Node's DecompressionStream: `inflate` / `inflateRaw` tails →
  `ERR_TRAILING_JUNK_AFTER_STREAM_END`. A second gzip member decodes there,
  because Node's DecompressionStream concatenates. So the in-process harness hides the
  multi-member divergence, and ADR-0159 Design note 4 ("the SAME spec primitive")
  does not hold for gunzip.

Spec: the Compression Streams Living Standard makes extra input after the
ADLER32 / BFINAL block / gzip member a TypeError, and allows one gzip member.
The wording comes via a fetch summary and is not byte-verified. Chromium conforms.

Facts that bound a fix:
- Catching the junk error loses output. Chromium drops queued chunks: 600000 B + `\n` delivered 131072 B before the error.
- Chromium reports the two failures in different phases: junk → `write` rejects; truncated → `close` rejects.
- DecompressionStream exposes no consumed-byte offset.
- `pako@1.0.11` (lockfile) matches Node on inflate tails. On gunzip it differs: `+'\n'` gives OK (Node: error), and with 2 members it drops the second.

No parity/conformance case feeds tails or members
(`tools/node-parity-runner/cases/zlib/*`, `tests/conformance/builtins/zlib*.test.ts`).
Compat `zlib.md` rows `gunzip` / `inflate` / `inflateRaw` are ✅ with no caveat.

## Question

Fix now, engine-free, by bisecting prefixes over fresh DecompressionStreams
using the write-vs-close phase (O(n log n), unmeasured; phase stability across
engines is unverified)? Or fold it into the sync-engine choice
(`runtime-js/zlib-web-compression-subset` §Sync engine), which knows the end
offset natively? Until then the compat ✅ rows should read ⚠️. Owner:
runtime-js. Trigger: zlib engine refine, or the next pdf-t3 agent run. RED
(in-process): `inflate(valid + '\n')`; Chromium e2e RED: gunzip with 2 members
and with zero padding.
