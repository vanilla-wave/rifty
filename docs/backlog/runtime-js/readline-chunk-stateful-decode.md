---
area: runtime-js
status: draft
title: readline decodes byte input with its own StringDecoder per Interface
created: 2026-11-17
why: rifty readline decodes each byte chunk on its own, so a UTF-8 character split across chunks becomes U+FFFD
sources: [docs/backlog/runtime-js/node-builtins-loud-stub-capability-gaps.md]
code: [packages/runtime-js/src/builtins/null-net-stubs.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17).
`null-net-stubs.ts` `decodeReadlineChunk` decodes every Buffer chunk
independently (one-shot `bytesToString`); Node's `readline.Interface` keeps
one `StringDecoder('utf8')` and never touches the input. rifty instead calls
`input.setEncoding?.('utf8')` (`null-net-stubs.ts:125`), so a co-listener on a
stream `Readable` input gets strings where Node gives Buffers (probe
2026-11-17, Node v24.16.0: after `createInterface({ input: passThrough })`,
`readableEncoding` is null and a user `'data'` listener gets a Buffer). Inputs
without `setEncoding` (fs `ReadStream`, `fs-readstream-set-encoding`) reach the
per-chunk path.

Probe (scratch parity case, Node v24.16.0 vs rifty): file `€x\n`,
`readline.createInterface({ input: fs.createReadStream(f, { highWaterMark: 1 }) })`
→ Node line code points `20ac 78`, rifty `fffd fffd fffd 78`.
Fault: corrupt-input (lossy decode) at the readline byte-input boundary.
Compat: no readline row — silent gap. Dedup: git grep readline / setEncoding /
decodeReadlineChunk over docs/backlog, traps.md, ADR §Declined — no match
(`node-builtins-loud-stub-capability-gaps` lists throwing surfaces only).

## Next

Owner runtime-js; trigger: a claimed line reader over non-ASCII file or
socket input with small chunks. RED first (independent of
`fs-readstream-set-encoding`): a `PassThrough` input fed `e2 82` then
`ac 0a`, plus a co-listener asserting Buffer chunks and
`input.readableEncoding === null`.
