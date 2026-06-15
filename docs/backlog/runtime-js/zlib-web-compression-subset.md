---
area: runtime-js
status: draft
title: node:zlib web-compression subset
created: 2026-06-12
why: Consumer Ready roadmap calls out zlib as a high-frequency runtime wall; the web-backed async one-shot subset landed (ADR-0159), remaining surface is the deferred follow-ups below
sources: [docs/ROADMAP.md, docs/research/open-webcontainers-alternative-2026-06.md]
code: [packages/runtime-js/src/builtins/zlib.ts]
---

## Context

LANDED (ADR-0159 + ADR-0178, `docs/public/compat/zlib.md`): async one-shot
`gzip`/`gunzip`/`deflate`/`inflate`/`deflateRaw`/`inflateRaw` over the host
`CompressionStream`/`DecompressionStream`, wire-compatible with real Node both
directions, plus the narrow `createGzip()` / `Gzip` Transform subset needed by
Vite preview compression middleware. The all-throwing `node:zlib` stub is gone.
This item now tracks the surface DELIBERATELY deferred from those PRs.

## Options or Next

- **Remaining Transform streams** (`createGunzip`/`createDeflate`/`createInflate`/
  `createDeflateRaw`/`createInflateRaw`/`createUnzip` + `Gunzip`/`Deflate`/…
  classes): bridge `CompressionStream`/`DecompressionStream` ↔ Node `Transform`
  (flush opcodes, backpressure, chunk-boundary + error-code parity). `createGzip`
  / `Gzip` is landed under ADR-0178; do not infer the rest of the surface from it.
- **`unzip`/`unzipSync`** (auto-detect gzip vs zlib): header-sniff (0x1f8b → gzip,
  else zlib-deflate) is small but has its own parity surface; add when a consumer
  needs Content-Encoding auto-detect.
- **`crc32`**: pure-sync, honestly implementable (~15 lines) — out of the
  compression subset, parked until a consumer reads it.
- Brotli / zstd / `*Sync` stay loud ceilings — no honest browser path (no Web API
  for brotli/zstd; async-only stream API can't back a sync facade). Promote only if
  a browser primitive appears.
- **Cross-engine e2e** (residual risk, low — ADR-0159 Design notes): conformance +
  parity drive the WHATWG `CompressionStream` via Node's in-process global, not
  Chromium's; only the gunzip path rides on the npm-install e2e (`unpacker.ts`). A
  small in-runtime e2e exercising compress + deflate/raw in real Chromium would close
  the last verification gap. Gate: any zlib-touching e2e flow worth pinning in-browser.

## Reversibility

Landed additive methods were REVERSIBLE (ADR-0159 and ADR-0178 record the subset
boundaries + options policy). The remaining Transform-stream contract is
IRREVERSIBLE and needs a superseding/follow-up ADR before implementation; `unzip`/`crc32` are additive
(REVERSIBLE).
