# ADR 0390: Ship a copyable Workbench runtime asset closure

Status: Accepted
Date: 2026-09

## Context

Goal I2 requires a static host without consumer Worker/SW compilation.
ADR-0282 retains sealed custom entries; ADR-0352 requires synchronous QuickJS
configuration and an installed kernel listener before init can arrive.
ADR-0381 owns the lexical, lazily loaded eval compiler.

## Decision

Workbench publishes `dist/assets/` beside its normal root entry. Copy the whole
directory, locating it relative to the resolved published Workbench root.
No new package export is needed; existing custom entries remain supported.

The generated Workbench build runs normal tsup, then a package-owned esbuild
step: six current Worker entries, SW, all relative JS chunks, quickjs.wasm and
sql-wasm.wasm. Stable entry filenames, opaque chunk filenames. Copy one complete
build; host selects serving URLs and existing deployment options.

Publishing owns os/path/perf_hooks/fs aliases to real runtime-js builtins and
the TypeScript host constants. A package-owned kernel wrapper statically imports
the sealed kernel and synchronously assigns its relative quickjs.wasm URL.
No awaited bootstrap import, CDN, alternate runtime or placeholder builtin.

Build checks the complete emitted import graph has no external edges. Node-only
fallback imports may be external during resolution only when tree-shaking removes
them from emitted output. Preserve the generated compiler's lexical factory and
lazy boundary; the copied worker's real VM evaluation exercises that boundary.

Candidates: keep consumer bundling/wrapper recipe — violates I2; add another
runtime/asset loader — unnecessary while existing URLs and relative modules
suffice; package the existing worker compositions once — selected.

## Consequences

Host application compilation remains ordinary. SDK/runtime policy is unchanged;
the optional no-COI entry shares distribution and gets a copied-asset regression
probe. Existing source-entry and custom-wrapper proofs remain available.
