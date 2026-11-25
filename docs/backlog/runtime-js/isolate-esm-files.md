---
area: runtime-js
status: draft
title: ES module files load in the isolate guest as in `node <path>`, and its `require` returns to Node 24's default
created: 2026-11-24
why: the guest declares no ES module loader (`declareNoEsmLoader`, PR #440) because the loader needs `URL`; every `.mjs`, `"type": "module"` or typeless ESM `.js` is `NotImplementedError('isolate-host.esm')`, and `require` is Node's `--no-require-module`
epic: isolate-guest-modern-code
sources: [docs/backlog/epics/isolate-guest-web-api/reference/seam-esm/README.md, docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md]
code: [packages/isolate-guest/src/guest/entry.ts, packages/runtime-js/src/internal/esm-loader.ts]
---

## Context

Probe `seam-esm` §3 (2026-11-24, variant `url-esm`: core-js `URL` first, `declareNoEsmLoader`
removed), `sandbox.exec` vs Node v24.16.0: `.mjs` entry, `"type": "module"`, typeless ESM `.js`,
`import` of CommonJS, `import()` from CJS and ESM, top-level await, `require(esm)` with
`process.features.require_module` `true`, `createRequire(import.meta.url)`, JSON import with
`with { type: 'json' }`, `import.meta.*` equal Node. The loader itself needs nothing else. Stops:
nanoid 5 (`runtime-js/esm-import-binding-asi`); diagnostics differ (stack line, path instead of
file URL, no source header — direction F); `data:` imports are rifty's gap on every host.
Warm call unchanged by removing the declaration (≈0 ms).

Needs `runtime-js/isolate-guest-url`. Leaves ADR-0557's 2026-11-24 `--no-require-module` entry.
`-e` ES modules: goal `isolate-guest-modern-code` open questions. Compat ❌ isolate-host.md row "ES modules".
