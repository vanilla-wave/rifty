---
area: runtime-js
status: draft
title: CJS stack positions outside standalone first-line strict sources
created: 2026-10-20
why: Function's two wrapper lines shift ordinary CJS diagnostics relative to Node
sources: [docs/adr/runtime-js/0450-project-vm-script-offsets-through-one-owned-stack-hook.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/module-loader/cjs-factory.ts, packages/runtime-js/src/module-loader/cjs-stack-positions.test.ts]
---

## Context

Observed while moving esbuild to its stock Node entry. Node 24.16.0 reports
`function origin() {\n  return new Error('position');\n}` at line2,column10;
rifty's Function compiler reports line4,column10, during and after require.
Reproduce: `pnpm exec vitest run packages/runtime-js/src/module-loader/cjs-stack-positions.test.ts`;
two non-strict cases remain `it.fails`, retaining the original Node comparison.
This gap predates the cutover (BASE 10504415); it is not an esbuild admission
ceiling: all versions use the same compiler. The verified stock files start
with a standalone strict directive and now preserve executable coordinates.

Using ADR-0450's encoded sourceURL for all CJS broke ordinary require with a
non-configurable Error hook and leaked encoded filenames after hook replacement.
A filename offset registry is unsound: strict guest Function/eval can reuse the
same filename and visible CallSite metadata. Chromium148 getScriptHash is empty.
The existing compiler remains for other source shapes; no approximate mapping.

Dedup: loader-guest-source-url-override concerns filename comments;
cjs-wrapper-arguments-shape concerns factory arguments. Neither owns positions.
Fault: provenance-lie at the CJS compilation boundary. Compat explicitly ⚠️.

## Next

Owner runtime-js (CJS compiler). Trigger: real package diagnostics requiring
positions without a standalone first-line strict directive. Preserve frozen
hooks, raw filenames, native Function/eval coordinates, factory reflection,
and body syntax rejection. No extra registry without an immutable frame binding.
