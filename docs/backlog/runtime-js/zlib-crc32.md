---
area: runtime-js
status: draft
title: zlib.crc32 computes Node's CRC-32 on every host
created: 2026-11-24
why: `zlib.crc32(data[, value])` needs only the engine's CRC, no stream; rifty throws `NotImplementedError('zlib.crc32')` on browser hosts and `isolate-host.zlib.crc32` in the isolate guest
epic: node-zlib-on-every-host
sources: [docs/backlog/runtime-js/zlib-web-compression-subset.md, "PR #438 (isolate ceiling modules)"]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/isolate-guest/src/guest/ceiling-zlib.ts]
---

## Context

Goal `node-zlib-on-every-host` (map, 2026-11-24): absorbed by unit 3 (`runtime-js/zlib-node-lib-port`) — `crc32` is Node's `lib/zlib.js` `crc32` over the engine's `binding.crc32` (ADR-0573), not a separate pure-JS function; this item closes when unit 3 lands.

Candidate split from `runtime-js/zlib-web-compression-subset` ("`crc32`: pure-sync, honestly
implementable (~15 lines) — parked until a consumer reads it") by the manager's decision for
PR #438 (isolate ceiling modules) (2026-11-24: not in that unit, a shared-module change).
Node v24.16.0: `function crc32(data, value = 0)`, `zlib.crc32.length` 1; validates `data`
(string or ArrayBufferView) and `value` (uint32) before computing. One implementation would serve
both hosts (the guest's loud member would then reuse it). No consumer measured yet: exceljs's
crc32-stream uses its own `crc-32` package.
