---
area: runtime-js
status: draft
title: "In the isolate guest a required typeless `.js` that Node loads as an ES module loads as in Node"
created: 2026-11-22
why: Node 24 detects ESM syntax or a redeclared CJS binding (`let require = 1`) in a typeless `.js` and loads it as ESM; the isolate guest throws `TypeError: URLConstructor is not a constructor`
sources: [PR-421-external-review-round-1, docs/backlog/epics/node-file-entry-parity/map.md]
code: [packages/runtime-js/src/internal/posix-file-url.ts, packages/runtime-js/src/module-loader/resolver.ts, packages/isolate-guest/src/guest/web-shim.ts]
---

## Context

Found by the PR #421 external review (round 1), outside goal
`node-file-entry-parity`. Reproduced by this capture: Node v24.16.0 vs
`runCode` from `packages/isolate-host/dist` (built 2026-11-22 21:14, no later
source commit before HEAD f7710274d). Each program writes the file, then
`try { require(file) } catch (e) { print e.name: e.message }`:

| file body | Node v24.16.0 | isolate guest |
|---|---|---|
| `./b.js`: `let require = 1` | `{}` (loaded as ESM) | `TypeError: URLConstructor is not a constructor` |
| `./d.js`: `const exports = 1` | `{}` | `TypeError: URLConstructor is not a constructor` |
| `./a.cjs`: `let require = 1` | `SyntaxError: Identifier 'require' has already been declared` + stderr `(node:PID) Warning: Failed to load the ES module: <path>/a.cjs. Make sure to set "type": "module" …` | same SyntaxError, stderr empty |

The reviewer's expectation (SyntaxError for every CJS file) holds only for
`.cjs`; a typeless `.js` is Node's detect-module case. `node -e 'let require = 1'`
runs as CJS in both (exit 0, `typeof module` `object`): not affected.

Cause (read, not instrumented): `URLConstructor = globalThis.URL` is captured
at runtime-js module load, where the isolate has no `URL` (ceiling global,
installed after load, `web-shim.ts` `CEILING_GLOBALS`); the ESM path builds a
file URL with it. Same mechanism as the goal map's open question on the
isolate ESM entry (`import.meta.url`). Fault class: `sibling-drift` — one
runtime path behaves per host on a host-provided global; the leaked internal
name is not a named gap.

Compat: no row in `docs/public/compat/isolate-host.md` for a required ESM
`.js`; to add with the fix or as ❌ when the gap is declared.

## Acceptance

1. Isolate parity (`packages/isolate-host/tests`, oracle live `node -e`): each
   table row gives Node's stdout/stderr/exit, or a declared
   `NotImplementedError('isolate-host.<esm feature>')` + compat ❌ — never
   `URLConstructor`. → scenario

## Challenge

challenge: 2026-11-22 — finding capture; no premise critic (README §Challenge)
