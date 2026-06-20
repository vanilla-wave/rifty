---
area: runtime-js
status: parked
title: node:zlib web-compression subset
created: 2026-06-12
why: Consumer Ready roadmap calls out zlib as a high-frequency runtime wall; the web-backed async one-shot subset landed (ADR-0158), remaining surface is the deferred follow-ups below
sources: [docs/ROADMAP.md, docs/research/open-webcontainers-alternative-2026-06.md]
code: [packages/runtime-js/src/builtins/zlib.ts]
---

## Context

LANDED (ADR-0158, `docs/public/compat/zlib.md`): async one-shot `gzip`/`gunzip`/
`deflate`/`inflate`/`deflateRaw`/`inflateRaw` over the host `CompressionStream`/
`DecompressionStream`, wire-compatible with real Node both directions. The
all-throwing `node:zlib` stub is gone. This item now tracks the surface
DELIBERATELY deferred from that PR.

## Options or Next

- **Transform streams** (`createGzip`/`createGunzip`/`createDeflate`/`createInflate`/
  `createDeflateRaw`/`createInflateRaw`/`createUnzip` + `Gzip`/`Deflate`/… classes):
  bridge `CompressionStream` ↔ Node `Transform` (flush opcodes, backpressure,
  chunk-boundary + error-code parity). Broad/IRREVERSIBLE contract — needs its own
  ADR before implementation (ADR-0158). Gate: a real consumer that pipes through
  `createGzip()`.
- **`unzip`/`unzipSync`** (auto-detect gzip vs zlib): header-sniff (0x1f8b → gzip,
  else zlib-deflate) is small but has its own parity surface; add when a consumer
  needs Content-Encoding auto-detect.
- **`crc32`**: pure-sync, honestly implementable (~15 lines) — out of the
  compression subset, parked until a consumer reads it.
- Brotli / zstd / `*Sync` stay loud ceilings — no honest browser path (no Web API
  for brotli/zstd; async-only stream API can't back a sync facade). Promote only if
  a browser primitive appears.

## Reversibility

Landed additive methods were REVERSIBLE (ADR-0158 records the subset boundary +
options policy). The deferred Transform-stream contract is IRREVERSIBLE and needs a
superseding/follow-up ADR before implementation; `unzip`/`crc32` are additive
(REVERSIBLE).
