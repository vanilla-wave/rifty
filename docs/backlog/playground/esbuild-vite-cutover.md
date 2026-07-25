---
area: playground
status: draft
title: Esbuild/Vite cutover to registry adapter dispatch; host-asset and alias retirement
created: 2026-07-23
why: direct guest require('esbuild')/import('esbuild') must run the proven transform surface without Vite, and Vite must consume the same adapter through its concrete integration edge; the three overlapping legacy esbuild paths (full-package alias override, file-overlay shim, vendored wasm) collapse into the one registry path
epic: honest-shadow-substitutions
blocked_by: [npm-client/package-tree-authority]
sources: [ADR-0308, ADR-0300-quarry, docs/adr/npm-client/0051-native-dependency-install-policy.md]
---

## Context

Slice `esbuild-vite-cutover` (see epic §Budget). Real executable-adapter
dispatch (ADR-0308): activation from the installed/admitted substitution, so
direct esbuild and Vite share one path; Vite-specific recognition lives only
in the concrete Vite/esbuild integration edge and never enters generic
owner/admission/bootstrap. Retires the host-asset path and the
`@esbuild/wasi-preview1` alias (measured ~5.06 MB of alias transfer per cold
install on the quarry). CLI surface mirrors the Sass rule: `esbuild` bin →
named `NotImplementedError('esbuild.cli')` + compat ❌, no silent
`command not found`. Matched browser proof; adapter consumes capabilities via
the existing one-shot kernel entry-port mechanism (no new kernel concept — the
Contract confirms explicitly).

Absorbs `npm-client/esbuild-substitution-strategy-reconciliation` (folded
2026-07-23): its three-path inventory — (1) bakedOverrides alias to
`@esbuild/wasi-preview1@0.28.0`, (2) `esbuildShimFiles` overlay passthrough,
(3) build-time-vendored `esbuild.wasm` via ADR-0047 binding, plus the
`SHIM_ESBUILD_VERSION='0.21.5'` vs 0.28.0 contradiction — is the exact legacy
surface this cutover deletes; its "measure whether dropping the override
breaks real-Vite e2e" step is subsumed by this slice's matched browser proof.

No user-observable fork remains; ordinary compilation owns pickup.
