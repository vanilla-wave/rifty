---
area: perf
subsystem: runtime-js
status: active
title: ADR-0081 — bytesToString decode helper on @riftydev/io public surface
created: 2026-06-08
why: fs text reads do Buffer.from(bytes).toString(enc) — full-buffer copy then decode; needs cross-package export, write-before-code
sources: [perf-audit #12, adr-plan A/ADR-0081, ADR-0029, ADR-0041]
---
## Context
fs.ts:140-142 / buffer-prototype.ts:33: `Buffer.from(bytes).toString(enc)` allocates a full copy then decodes, the default path behind every encoded fs read. New export on `packages/io/src/index.ts` consumed by runtime-js. rule1 (cross-package public API) → NEW ADR, write-before-code.
## Options / Next
Add `bytesToString(bytes, enc): string` to io index; call in fs.ts encoded branch. Keep `!encoding → Buffer.from(bytes)` (owned-mutable Buffer, Node parity). Prefer re-export/alias of internal buffer-codec.ts:58 `decode(view, enc)` over duplicating. Parity case: empty / odd-length utf16le / latin1-high / hex.
## Reversibility
IRREVERSIBLE — rule1 new cross-package public export. NEW ADR before impl. No decision subagent.
