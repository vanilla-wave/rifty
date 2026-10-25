# ADR 0546: Produce browser-compatible Brotli dependency snapshots

Status: Accepted
Date: 2026-10

## Context

The user selected built-in Brotli production for embedders, preserving gzip
callers and browser-compatible root API. Chromium 148 lacks Brotli
CompressionStream. HTTP decoding already works; no reader codec is needed.

## Decision

Extend `ProduceDependencySnapshotOptions` with `encoding?: 'gzip' | 'br'`;
omission selects gzip. `ProducedDependencySnapshot.contentEncoding` names the
actual representation. Reject unknown encodings before acquisition. Identity
still hashes decoded TAR; pin/replay validation and 128 MiB bounds remain.

Lazy-import pinned `brotli-compress@2.2.2`, quality 11, for Brotli only. Its
inline WASM ESM entry runs in Node and browsers with no external WASM URL or
caller codec. Keep native CompressionStream for gzip. Fail encoder errors
visibly; no disguised fallback. Quality is an implementation choice, no knob.

Supersedes only ADR-0387's tar.gz-only return, CompressionStream-only encoder
and no-new-dependency constraints. Root API, host compatibility and pin rules
remain. DEC-2 independent critic (2026-10-23): clear; external recompression,
Node-only and CompressionStream-only cannot meet the selected result.

## Corrections

- 2026-10-23: Use quality 11 instead of 6. One-time production CPU is secondary
  to download size; the Vite TAR is ~22% smaller than gzip (~5% at quality 6).
  Quality remains internal; no caller knob.

## Consequences

Inline module is 1,360,947 B, fetched/evaluated on Brotli demand in a splitting
bundler. It uses synchronous WASM CPU inside the async producer; browser
embedders should run production in a Worker. Quality 11 on the existing Vite TAR:
27,831,808 B → 7,635,659 B, ~39 s on this host; gzip 9,770,964 B. This is about
1.5 s/MB of TAR in Node; 128 MiB would take roughly 3 minutes at that rate
(extrapolation, not a measured maximum-size run). No universal
compression ratio/performance claim. Measurements and executable proof:
`docs/backlog/distribution/reference/brotli-snapshot-production-evidence.md`.

Serve Brotli with HTTP Content-Encoding, gzip alternative, negotiated cache
variants. Raw `.tar.br` is not admitted. No default asset migration.
