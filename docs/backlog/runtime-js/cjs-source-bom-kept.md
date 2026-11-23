---
area: runtime-js
status: draft
title: CJS loader keeps a leading BOM in compiled source, as Node's require()
created: 2026-11-17
why: rifty strips a leading BOM from every module source; Node's CJS loader compiles it, so a BOM before `#!` is a SyntaxError in Node and runs in rifty
sources: [docs/adr/runtime-js/0069-readable-set-encoding.md, docs/backlog/runtime-js/cjs-wrapper-stack-positions.md]
code: [packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/builtins/node-entry.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (wave-1 no-COI office docs,
2026-11-17). `resolver.ts:24` `new TextDecoder('utf-8')` (strips one BOM)
decodes every resolved file in `readResolved` (`resolver.ts:883`), for
require() and import() alike; then strips `#!` only at char 0.

Node v24.16.0 (`/tmp` probe, files written with `printf '\xef\xbb\xbf…'`):

| input | Node | rifty |
|---|---|---|
| `require('./b.cjs')`, BOM + `#!/usr/bin/env node` | `SyntaxError: Invalid or unexpected token` | runs, exports 2 |
| `node main.cjs` / `node main.js` (no `type`), BOM + `#!` | SyntaxError | runs (import-shaped entry read; code read, not probed) |
| `require('./e.mjs')` (require(esm)), BOM + `#!` | SyntaxError | runs (BOM and `#!` stripped; code read, not probed) |
| `import('./b.cjs')` / `import('./e.mjs')`, BOM + `#!` | runs (ESM loader strips) | runs |
| BOM'd `.cjs` without `#!` | runs (V8 whitespace); line-1 column counts the BOM (`c.cjs:1:8`) | runs |
| `require('./x.json')`, BOM'd `package.json`, `import … with {type:'json'}` | BOM stripped | stripped |

Rule: the CJS loader (`require`, CJS `runMain`, require(esm)) compiles the
source as `fs.readFileSync(f, 'utf8')` returns it; the ESM loader and JSON
readers strip. rifty's `node-entry.ts` runs every entry through
`loader.import`, so a CJS entry takes the import-shaped read; a fix must keep
`readResolved`'s `esm` flag and the entry path apart. Line-1 columns overlap
`cjs-wrapper-stack-positions`. Guard parity that must stay green:
`modules/require-bom-strip`, `modules/esm-bom-strip`. No compat row claims it.
Fault: sibling-drift between the CJS loader and Node's fs-read source.

Scope: the 2026-11-17 BOM fix request scoped the loader as keep-stripping
(premise: Node strips module source — the probe shows it does not for CJS);
changing CJS behavior is a user-observable choice → confirm with the user at
pickup.

Dedup: no backlog/traps/ADR match for BOM in module source (git grep BOM,
stripBOM, feff over docs/backlog, docs/adr, traps.md).

## Next

Owner runtime-js; trigger: a claimed program or package whose CJS file starts
with BOM + `#!`, or a CJS line-1 position parity case. RED first: parity case
with a BOM + `#!` `.cjs` under require() (Node SyntaxError).
