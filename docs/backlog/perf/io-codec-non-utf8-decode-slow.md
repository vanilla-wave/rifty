---
area: perf
status: draft
title: Non-utf8 decode in `@riftydev/io`'s Buffer codec is tens to hundreds of times slower than Node
created: 2026-11-25
why: hex/base64/base64url/latin1/ascii/utf16le `bytesToString` (behind `Buffer#toString`, `string_decoder`, `setEncoding`) builds strings in JS — 13 MiB to hex takes 838 ms, Node 1.9 ms (reviewer: 206 vs 4 ms); utf8 equals Node
sources: [docs/backlog/perf/reference/io-codec-decode-bench.mts]
code: [packages/io/src/buffer-codec.ts]
---

## Context

Discovery of PR #462's external review (2026-11-25; string_decoder now decodes every encoding through
this codec). Probe: `reference/io-codec-decode-bench.mts` (`npx tsx <file> <repo>`), 13 MiB
of `(i * 7919) & 0xff` (every byte value, period 256; as utf8 mostly invalid sequences), `bytesToString(bytes, enc)` vs Node's `Buffer#toString(enc)`, min of 3,
Node v24.16.0 in-process, darwin-arm64, load ~5:

| enc | rifty ms | Node ms |
|---|---|---|
| hex | 838.0 | 1.9 |
| base64 | 33.1 | 1.0 |
| base64url | 56.4 | 0.7 |
| latin1 | 29.8 | 0.4 |
| ascii | 29.0 | 0.9 |
| utf16le | 17.0 | 0.3 |
| utf8 | 38.9 | 39.0 |

A second run (review delegate, load 4.6) reproduced it: hex 857/1.7 ms. The PR #462 reviewer's
machine: hex 206 ms vs Node 4 ms — input and machine unknown, the 4× gap unexplained. Output on the
small parity inputs equals Node (`buffer/*`, `string_decoder/encodings-split`); the probe does not
compare output. Code: `hexDecode` appends per byte
(`toString(16).padStart`); latin1/ascii/utf16le/base64 build 8192-entry number arrays for
`String.fromCharCode.apply`; base64url adds three regex passes (`+`, `/`, trailing `=`) over the base64 string. Not measured
in Chromium or the isolate guest.

Dedup: `git grep` over `docs/backlog` for hex/base64/latin1 decode speed and `buffer-codec`.
Predecessor: `perf/reference/js-runtime-perf-audit-2026-06-05.md` «Char-by-char decode loops» (and
`js-runtime-perf-adr-plan-2026-06-06.md`) rated these loops «~1.5–2×, not quadratic, low-value»;
the `fromCharCode.apply` batching came from it, hex stayed per byte — the numbers above contradict
that rating. `perf/io-bytes-to-string-decode-helper` is the fs copy (a different cost). Traps and
ADR §Declined concepts: none.

## Next

Owner io; trigger: a claimed program decoding large buffers to hex/base64 (or a stream with
`setEncoding('hex' | 'base64')`) where the time matters. Measure in Chromium and the isolate first;
the output stays pinned by the parity cases above.
