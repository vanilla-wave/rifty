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

## Compilation measurement — 2026-10-20

PR #379 HEAD `5bd1e4b06`, macOS 26.6.2 arm64, Chromium 148.0.7778.96.
Three fresh browser/worker contexts per variant, instant TypeScript 5.9.3 and
Vite 7.3.6 snapshots. Timed only factory construction with captured
`performance.now()`; normal `compileCjsFactory` versus a temporary single
`new Function(...parameters, source + sourceURL)`. Same boot, TS2322 diagnostic,
`node -e "console.log(require('typescript').version)"`, and `npx vite build`
passed in both variants (12 scenarios). Instrumentation and baseline restored.

- TS language-service worker does **not** call `compileCjsFactory`:
  `packages/ts-language-service/src/lib-dts.ts` constructs one Function.
  Its 9,112,572-character source compiled in 50.110/54.995/50.850 ms;
  second batch 52.325/50.230/50.715 ms.
- Ordinary `require('typescript')`: 9,112,579 transformed characters,
  **no first-line strict directive**, hence already one Function.
  Normal 51.425/52.395/55.735 ms; single 50.885/53.640/57.225 ms.
  The suspected TypeScript double parse is absent in both paths.
- Vite build: 13 CJS factories / 181,162 characters, six strict factories.
  Normal totals 3.120/3.225/3.080 ms; single 1.940/1.885/1.890 ms.
  Strict-only totals 2.540/2.620/2.545 versus 1.480/1.450/1.450 ms.
  Median total difference **1.230 ms**, not hundreds; no performance item.
  Vite's ESM chunks do not enter this CJS boundary. No end-to-end speed claim.

Reproduction artifacts: `/tmp/pr379-measure/{instrument.py,pr379-measure.spec.ts,
raw.jsonl,double-complete.log,single.log}`. The temporary Playwright spec uses
`bootOwner` + `currentSessionTools().typescript` / `execLine`, records per-factory
filename/character count/strict predicate/time outside the timed interval;
`RIFTY_PLAYGROUND_PORT=5397 pnpm exec playwright test --config
playwright.browser-unit.config.ts tests/browser-unit/pr379-measure.spec.ts
--repeat-each=3`. Wall-clock timing is host-specific; unchanged validation
still prevents wrapper escape. Existing stack-position work remains the trigger.
