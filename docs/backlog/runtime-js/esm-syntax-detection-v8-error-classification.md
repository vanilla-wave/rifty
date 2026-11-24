---
area: runtime-js
status: draft
title: "Whether source has ESM syntax is decided as Node decides it, from V8's CommonJS compile error, not a whole-file parse"
created: 2026-11-24
why: Node's `containsModuleSyntax` reads V8's CJS compile error (`Unexpected token 'export'`, `Cannot use import statement outside a module`, a redeclared wrapper name → module parse); rifty requires the whole file to parse as a module, so source that fails to parse is classified differently
sources: [PR-440]
code: [packages/runtime-js/src/module-loader/resolver-profile.ts, packages/runtime-js/src/module-loader/require-esm-refusal.ts]
---

## Context

Found by the PR #440 review, round 1 (2026-11-24). Probes, Node v24.16.0:

- Typeless `b1.js` = `export const = ;`: `require` and `import()` both → `SyntaxError: Unexpected
  token '='` (compiled as a module). rifty (`detectJavaScriptKind`: CJS parse fails, module parse
  fails → `cjs`) compiles it as CommonJS: V8's `Unexpected token 'export'` inside its
  `ModuleLoadError` wrapper — code read, every host.
- `tm/bad.js` = `export const = ;` under `"type": "module"`, `node --no-require-module`:
  `ERR_REQUIRE_ESM` text (B) "Instead change the require of bad.js in <parent> to a dynamic
  import()…"; the isolate guest gives (C) "bad.js is treated as an ES module file…" (pinned,
  `packages/isolate-host/tests/require-esm.test.ts`); code and constructor equal.

Owner: runtime-js module loader. Trigger: a user request, or a package hitting a broken-ESM
classification. Compat ⚠️ isolate-host.md "`require()` of an ES module".
