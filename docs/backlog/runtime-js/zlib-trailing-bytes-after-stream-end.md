---
area: runtime-js
status: draft
title: "node:zlib async inflate / inflateRaw ignore trailing bytes, and gunzip accepts zero padding and multiple members, as Node does"
created: 2026-11-18
why: "In Node, a zlib/raw stream followed by extra bytes still decodes (e.g. a PDF FlateDecode slice that keeps its EOL), and gzip members are concatenated. rifty's DecompressionStream backend rejects both. Compat is ⚠️ since 2026-11-18"
user_story: As an agent decoding PDF FlateDecode streams, I want `await util.promisify(zlib.inflate)(slice)` on a slice cut up to `endstream` to return the content as in Node, but today it rejects with `TypeError: Junk found after end of compressed data.`
sources: [docs/adr/runtime-js/0159-node-zlib-web-compression-backed-async-subset.md, docs/public/compat/zlib.md, docs/backlog/runtime-js/reference/pr-403-final-green.json]
code: [packages/runtime-js/src/builtins/zlib.ts]
---

## Context

Source: the Final+GREEN Ecosystem-UX concern on PR #403
(`reference/pr-403-final-green.json`). The PR's ceiling hint ("async `zlib.inflate`
works") sends the pdf-t3 author (no-COI office-docs, 2026-11-12) to a call
that still fails. pdf-t3 slices
`b.subarray(m.index+m[0].length, s.indexOf('endstream', m.index))`, which keeps the
EOL: all 5 FlateDecode slices in its fixtures end in `\n`.

Node v24.16.0, `promisify(zlib.X)` and `XSync` (probe 2026-11-18):
- `inflate` / `inflateRaw` with a tail of `\n`, CRLF, `JUNK!` or 8×`0x00` → OK, returns the data.
- `gunzip`:
  - `+8×0x00` → OK;
  - `gzip(a)+gzip(b)` → `a+b`.
- pdf-t3 slices: async `inflate` decodes all 5.
- `gunzip +'\n'` / `+'JUNK!'` errors in Node as well (`Z_BUF_ERROR` / `Z_DATA_ERROR`). Only the
  code differs there, and that divergence is already declared (ADR-0159 §Error divergence).

Rifty @ 39cf60307: `runStream` (`zlib.ts:174`) hands the host stream error to
the callback, with no trailing-data handling.
- Chromium 148.0.7778.96 (bundled `zlib.ts` in a Playwright page):
  - `inflate`, `inflateRaw` and `gunzip`, with each tail above → `TypeError: Junk found after end of compressed data.` (no code);
  - a second gzip member → the same TypeError.
- tsx / Node's DecompressionStream:
  - `inflate` / `inflateRaw` tails and `gunzip +8×0x00` → `ERR_TRAILING_JUNK_AFTER_STREAM_END`;
  - a second gzip member decodes, because Node's DecompressionStream concatenates.
  - So the in-process harness hides only the multi-member divergence (ADR-0159
    Design note 4 correction 2026-11-18).

Spec: the Compression Streams Living Standard makes extra input after the
ADLER32 / BFINAL block / gzip member a TypeError, and allows a single gzip member. The
wording came via a fetch summary and is not byte-verified. Chromium conforms.

Facts that bound a fix:
- The Chromium 148 probes behind these facts were not persisted. Re-run them before design.
- Catching the junk error loses output: Chromium drops queued chunks
  (600000 B + `\n` delivered 131072 B before the error).
- Junk and truncation fail at different points: junk → `write` rejects; truncated → `close` rejects.
- DecompressionStream exposes no consumed-byte offset.
- `pako@1.0.11` (in the lockfile) matches Node on inflate tails but diverges on gunzip: `+'\n'` / `+'JUNK!'` → OK
  (Node: error), and with 2 members it drops the second.

No parity/conformance case feeds tails or extra members
(`tools/node-parity-runner/cases/zlib/*`, `tests/conformance/builtins/zlib*.test.ts`).

## Question

Two options:
- Fix now without an engine: bisect prefixes over fresh DecompressionStreams, using
  the write-vs-close phase. Cost O(n log n), unmeasured; whether the phase is stable across
  engines is unverified.
- Fold it into the sync-engine choice (`runtime-js/zlib-web-compression-subset`
  §Sync engine). An engine knows the end offset natively.

Owner: runtime-js. Trigger: zlib engine refine, or the next pdf-t3 agent run.

REDs:
- in-process: `inflate(valid + '\n')`, `gunzip(valid + 8×0x00)`;
- Chromium e2e: gunzip with 2 members.
