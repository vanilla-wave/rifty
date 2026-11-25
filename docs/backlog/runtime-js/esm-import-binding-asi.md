---
area: runtime-js
status: draft
title: rifty's ESM transform turns an imported binding that starts a line after a statement without `;` into a call of the previous expression
created: 2026-11-24
why: `renderImportBinding` rewrites an imported name as `(ns().name)`; after a line with no `;` the `(` continues the previous expression, so semicolon-free ESM breaks (nanoid 5: `Buffer.allocUnsafe(...) is not a function`)
sources: [docs/backlog/epics/isolate-guest-web-api/reference/seam-esm/README.md]
code: [packages/runtime-js/src/module-loader/esm-declaration-plan.ts]
---

## Context

Probe `seam-esm` §3 (2026-11-24, isolate variant `url-esm`, Node v24.16.0): minimal case
`let a\na = String(1)\ncrypto.getRandomValues(…)` with `crypto` imported →
`TypeError: String(...) is not a function`; Node prints `asi ok 1 2`. nanoid 5's `index.js` stops
there; with a `;` added in a copied nanoid (diagnostic only) its output equals Node's. Code:
`esm-declaration-plan.ts:218-225`. Every host by source; browser hosts not run. Owner runtime-js
ESM transform; no compat row yet.
