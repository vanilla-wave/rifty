---
area: runtime-js
status: draft
title: Plain ESM stack frames report Node's line, column and file URL
created: 2026-10-25
why: untransformed .mjs/.js ESM frames are shifted by the loader's rewrite (non-uniform: +5 lines nested, +7 top-level, top-level column changed) and named by bare path with `eval`, where Node reports the source position under a file:// URL
sources: [ADR-0136, ADR-0450, PR-158-salvage-probe-2026-10-25]
code: [packages/runtime-js/src/module-loader/esm-job-types.ts, packages/runtime-js/src/module-loader/esm-job-preparation.ts, packages/runtime-js/src/module-loader/esm-job-evaluation.ts, packages/runtime-js/src/module-loader/source-maps.ts]
---

## Context

Discovered while re-verifying PR #158's plain-ESM source-map draft on main
`7d038adb0`. Fixture `gen.mjs`:
`const a = 1;\nexport function origin() {\n  return new Error('position');\n}\nexport const e = origin();`

- Node v24.16.0: `at origin (file:///…/gen.mjs:3:10) | at file:///…/gen.mjs:5:18`
- rifty (`createModuleLoader` over MemoryFsSync, vitest/V8):
  `at origin (/work/gen.mjs:8:10) | at eval (/work/gen.mjs:12:11)`

The ESM rewrite records a generated-line map (`esm-job-preparation.ts:51`)
but `SourceMapRegistry.has()` is true only with a transform map
(`source-maps.ts:58-60`), so `withStackRemapping` (`source-maps.ts:109`) skips
plain modules and `ESM_STACK_LINE_OFFSET` (`esm-job-types.ts:114`) is never
applied to them. Frame file identity is the bare module id, not Node's
`file://` URL; top-level frames are `eval`, not anonymous.

Dedup: `cjs-wrapper-stack-positions` owns CJS positions only;
`loader-guest-source-url-override` owns guest `//# sourceURL=` naming;
`worker-stack-remap-error-overlay` owns transform-map frames in Workers and
after top-level evaluation; this item owns plain (map-less) ESM coordinates
in every phase. Compat `modules.md` "ESM stack positions" ⚠️. Fault:
provenance-lie at the ESM evaluation boundary. Probe = uncommitted scratch.

## Question

Which mechanism owns plain-ESM coordinates (always-on rewrite line map vs an
unshifted rewrite), and is file-URL frame identity in scope with it?
Settled at PICKUP against Node parity for nested, top-level and post-await
frames; must keep ADR-0136/0450's scoped hook ownership.
