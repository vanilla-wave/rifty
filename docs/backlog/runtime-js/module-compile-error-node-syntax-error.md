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

## Dead ends (PR #421, goal node-file-entry-parity, three review rounds)

The CJS side was tried and rolled back to main's `ModuleLoadError` (manager
decision after external review round 3, 2026-11-23); every attempt rebuilt
what only V8 knows — the parse position and message — from another source:
- **position from the source** (rounds 1–2): acorn's stop token matched
  against V8's message to print a header; false carets (`foo((a) });` acorn
  1:9, Node caret 7; `const a}`; `class X { … }` Node prints no caret).
- **acorn's position as a separate line** (round 2, `(rifty parser position:
  …)`): acorn names the next token, V8 the error site — an unclosed comment
  `items.reduce(…, 0 /* initial value);` … `/* end */` gives 9:1 vs Node line 2;
  top-level `new.target;` + a later error gives 1:1; 45 of 2000 mutations a
  wrong line, 20 more than 10 lines off.
- **the message from `new Function` over the source** (rounds 2–3): V8 reads
  it relative to the Function wrapper, not the file: a stray `})` →
  `Single function literal required`, a stray `}` → `Unexpected identifier
  'console'` (Node `Unexpected token '}'`), a missing `}` → `Unexpected token
  ')'` (Node `Unexpected end of input`).
- **probing with indirect eval of an unclosed wrapper**: evaluates guest text
  (a body closing the wrapper runs) — never.

Needed: an engine-level source for V8's own message and position of a
function-body parse (Node's `compileFunction`). Untried candidate: the whole
report from one source — rifty's own parser, message and position together
(acorn's message and location, named as rifty's), no V8 text mixed in.
