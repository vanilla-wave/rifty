---
area: runtime-js
status: draft
title: fs ReadStream exposes Readable#setEncoding
created: 2026-11-17
why: rifty fs ReadStream extends EventEmitter, so `createReadStream(f).setEncoding('utf8')` throws "not a function" where Node decodes
sources: [docs/public/compat/fs.md, docs/backlog/runtime-js/fs-readstream-pipe-node-options.md]
code: [packages/runtime-js/src/builtins/fs-streams.ts, tools/compat-matrix-generator/fs-matrix.js]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17).
`fs-streams.ts` `class FileReadStream extends EventEmitter` re-implements
Readable members; `setEncoding` is absent. Probe (scratch parity case,
Node v24.16.0 vs rifty): `typeof fs.createReadStream(f).setEncoding` → Node
`function`, rifty `undefined`; calling it → `TypeError: s.setEncoding is not a
function`. The `{ encoding }` option works (ChunkDecoder). The compat `fs.md`
`createReadStream` row is ⚠️ but does not list this gap — a silent gap.
Same root as `fs-readstream-pipe-node-options` (no inherited
`Readable.prototype`), kept separate: a different member and consumer (decode,
not end/unpipe); a shared fix closes both. Dedup: git grep setEncoding /
FileReadStream over docs/backlog — only that pipe item.

## Next

Owner runtime-js; trigger: a claimed program calling `setEncoding` on an fs
read stream. RED first:
parity `fs.createReadStream(f).setEncoding('utf8')` emits strings (utf8 split
char across `highWaterMark: 1` chunks).
