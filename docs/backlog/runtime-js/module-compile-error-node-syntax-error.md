---
area: runtime-js
status: draft
title: "A CommonJS or ES module that fails to compile throws Node's SyntaxError, not the loader's ModuleLoadError wrapper"
created: 2026-11-18
why: Node throws V8's `SyntaxError: <message>` (catchable as `SyntaxError`, printed with a `<file>:<line>` header and caret); rifty throws `ModuleLoadError` (`SYNTAX_ERROR`) whose message embeds the path and, for ESM, the loader parser's message
sources: [docs/public/compat/process.md, tests/no-coi/no-coi-fatal-stderr.spec.ts]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/errors.ts, packages/runtime-js/src/module-loader/esm-ast.ts]
---

## Context

PR #406 outside finding 3. Source `const a = 1;\nlet x = ;\n`, Node v24.16.0,
probe 2026-11-18:

- `node syntax.cjs` / `node syntax.mjs` → `<root>/syntax.cjs:2` (ESM
  `file://…`) / `let x = ;` / caret under `;` / `SyntaxError: Unexpected token ';'`
  + internal frames, status 1.
- `try { require('./syntax.cjs') } catch (e)` and `await import('./syntax.mjs')`
  → `e instanceof SyntaxError` true, `name` `SyntaxError`, `message`
  `Unexpected token ';'`, no `code`.

Rifty, both hosts (pinned residual in `no-coi-fatal-stderr.spec.ts`; kernel
child byte-identical in a scratch COI probe at PR #406):
`ModuleLoadError: Failed to compile CJS module <root>/syntax.cjs: Unexpected token ';'`
(`cjs.ts`: the `new Function` SyntaxError is wrapped to "surface a directed
error naming the module") and
`ModuleLoadError: Failed to parse ESM source for <root>/syntax.mjs: Unexpected token (2:8)`
(`esm-ast.ts`, the loader's parser; its `(2:8)` is Node's caret position, the
message lacks V8's `';'`).
The caught-error side (`instanceof`, `name`, `code`) is code read, not probed.
Neighbour: `fatal-report-node-shape` owns the printed header. Fault:
`provenance-lie` at the module compile boundary. Compat ⚠️ `process.md`
"Fatal error stderr bytes".

## Question

Can rifty throw V8's own `SyntaxError` (V8's message, e.g. `Unexpected token ';'`)
for both loaders and still name the module (Node names it only in the header)?
