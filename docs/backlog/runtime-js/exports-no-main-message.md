---
area: runtime-js
status: draft
title: "A package whose exports define no entry for require throws Node's ERR_PACKAGE_PATH_NOT_EXPORTED text and shape"
created: 2026-11-24
why: Node says `No "exports" main defined in <pkg>/package.json` (an `Error`); rifty says `Package subpath '.' is not defined by 'exports' in <pkg>/package.json` (a `ModuleLoadError`), same code
sources: [PR-440]
code: [packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/module-loader/errors.ts]
---

## Context

Found by the PR #440 review, round 1 (2026-11-24); on the isolate path since `module-sync` is
not taken there. Package `onlyesm`, `exports` `{".": {"module-sync": "./r.mjs", "import": "./r.mjs"}}`,
`require('onlyesm')` from `nm/q.js`:

- Node v24.16.0 `--no-require-module`: `Error` `ERR_PACKAGE_PATH_NOT_EXPORTED` `No "exports" main defined in <root>/nm/node_modules/onlyesm/package.json`.
- isolate guest (`sandbox.exec`): `ModuleLoadError` `ERR_PACKAGE_PATH_NOT_EXPORTED` `Package subpath '.' is not defined by 'exports' in /workspace/nm/node_modules/onlyesm/package.json`.

Browser hosts reach it with an `import`-only package (code read). Owner: runtime-js resolver.
Trigger: a user request or an agent run hitting it. No compat row yet.
