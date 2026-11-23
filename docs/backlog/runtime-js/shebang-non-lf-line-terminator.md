---
area: runtime-js
status: draft
title: "A module whose `#!` line ends in CR, U+2028 or U+2029 runs its later lines as in Node"
created: 2026-11-23
why: Node ends the hashbang at any line terminator and runs line 2; rifty's strip eats to the first LF, so the program silently runs nothing and exits 0
sources: [PR-421-external-review-round-3, tools/node-parity-runner/cases/modules/cjs-shebang.case.ts]
code: [packages/runtime-js/src/module-loader/resolver.ts]
---

## Context

Found by the PR #421 external review (round 3), outside goal
`node-file-entry-parity`. Reproduced by this capture (2026-11-23).

Node v24.16.0, file `#!/usr/bin/env node<T>console.log(1)\n` in `/tmp`:

| `<T>` | `node f.cjs` / `node f.js` / `node f.mjs` / `require('./f.cjs')` |
|---|---|
| `\r` | prints `1`, exit 0 |
| U+2028 | prints `1`, exit 0 |
| U+2029 | prints `1`, exit 0 |
| `\r\n` | prints `1`, exit 0 |

rifty, `runCode` from `packages/isolate-host/dist` (built 2026-11-23 00:26,
after HEAD eccbe3a9d), program writes `./f.cjs` then
`require('./f.cjs'); console.log('after')`:

| `<T>` | stdout | exit |
|---|---|---|
| `\r`, U+2028, U+2029 | `after` (line 2 never ran) | 0 |
| `\r\n` | `1`, `after` | 0 |

Cause (read): `readResolved` strips `/^#![^\n]*/` — LF only, where V8's
HashbangComment ends at any LineTerminator (LF, CR, LS, PS); with no LF the
whole file is the "shebang". The ESM kind takes the same strip (code read;
isolate `require('./f.mjs')` stops earlier at `URLConstructor`,
`isolate-require-esm-syntax-gaps`), as does a browser `node <file>` entry
(`node-entry.ts` → `loader.import` → `readResolved`; code read, not probed).
Fault: `sibling-drift` (rifty's copy of V8's hashbang lexing) shown as a
silent success. Dedup: no backlog/traps/ADR-declined match for a non-LF hashbang end;
neighbours, not duplicates: `cjs-source-bom-kept`,
`cjs-bom-shebang-syntax-error` (BOM before `#!`). No compat row claims it;
process.md "Run-to-completion loader parity (shebang, …)" names the parity
reuse only.

## Acceptance

1. Parity cases next to `modules/cjs-shebang` and `modules/esm-shebang` (and an
   isolate `node-file` row), one per `<T>` in the table: Node's stdout/exit
   from the live oracle; CR/U+2028/U+2029 RED on current main, `\r\n` a guard
   (green today). → scenario

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
