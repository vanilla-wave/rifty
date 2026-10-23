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

Lazy-import pinned `brotli-compress@2.2.2`, quality 6, for Brotli only. Its
inline WASM ESM entry runs in Node and browsers with no external WASM URL or
caller codec. Keep native CompressionStream for gzip. Fail encoder errors
visibly; no disguised fallback. Quality is an implementation choice, no knob.

Supersedes only ADR-0387's tar.gz-only return, CompressionStream-only encoder
and no-new-dependency constraints. Root API, host compatibility and pin rules
remain. DEC-2 independent critic (2026-10-23): clear; external recompression,
Node-only and CompressionStream-only cannot meet the selected result.

## Consequences

Inline module is 1,360,947 B, fetched/evaluated on Brotli demand in a splitting
bundler. It uses synchronous WASM CPU inside the async producer; embedders
may run production in a Worker. Quality 6 on the existing Vite TAR:
27,831,808 B → 9,253,244 B, ~860 ms on this host; gzip 9,770,964 B. No universal
compression ratio/performance claim. Measurements and executable proof:
`docs/backlog/distribution/reference/brotli-snapshot-production-evidence.md`.

Serve Brotli with HTTP Content-Encoding, gzip alternative, negotiated cache
variants. Raw `.tar.br` is not admitted. No default asset migration.
