---
area: runtime-js
status: draft
title: "`node --no-deprecation` / `--throw-deprecation` are accepted as in Node"
created: 2026-11-24
why: "rifty's `node` refuses both with `node: bad option: --no-deprecation` (exit 9); Node v24.16.0 runs the file (silencing a deprecation warning, or throwing it)"
sources: [docs/adr/runtime-js/0574-generate-legacy-node-url-and-node-querystring-from-pinned-node-sources.md]
code: [packages/runtime-js/src/internal/node-startup-options.ts]
---

## Context

Found by the PR #444 review (legacy `node:url`, round 1), reproduced 2026-11-24 in the COI
Workbench (scratch browser-unit run): `node --no-deprecation d.js` and `node --throw-deprecation
d.js` (d.js: `require('url').parse('http://a.com:xx/'); console.log('ok')`, DEP0170; rifty emits no DEP0169, ADR-0574) → exit 9,
`node: bad option: --no-deprecation` / `--throw-deprecation`. Live Node v24.16.0: `ok`; with
`--throw-deprecation` the deprecation throws (`node:internal/process/warning:176`). `process.noDeprecation`
set by code works (rifty honours it in `process-warnings.ts`). No compat row yet.

## Next

Owner runtime-js (node startup options). Trigger: a program or tool launching `node` with either
flag. First step: Node's handling of both (`process.noDeprecation`/`throwDeprecation`) vs rifty's
startup-option table.
