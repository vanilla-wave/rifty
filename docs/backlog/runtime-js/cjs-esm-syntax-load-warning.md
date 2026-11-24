---
area: runtime-js
status: draft
title: "A CommonJS compile SyntaxError of source that parses as an ES module emits Node's \"Failed to load the ES module\" warning"
created: 2026-11-24
why: Node writes `(node:<pid>) Warning: Failed to load the ES module: <file>. Make sure to set "type": "module" …` to stderr before rethrowing the SyntaxError; rifty writes nothing on any host
sources: [docs/backlog/runtime-js/isolate-require-esm-syntax-gaps.md]
code: [packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

Found by unit `runtime-js/isolate-require-esm-syntax-gaps` (2026-11-24), outside its boundary
(the shared CJS compile path; adding the warning would change browser hosts). Probe, Node v24.16.0:
`node -e "try{require('./a.cjs')}catch(e){console.log(e.name)}"` with `a.cjs` = `let require = 1`
(also `export const a = 1`) → stderr
`(node:<pid>) Warning: Failed to load the ES module: <root>/a.cjs. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.`
+ `(Use \`node --trace-warnings ...\` to show where the warning was created)`, stdout `SyntaxError`.
Same for a typeless `.js` with ESM syntax under `node --no-require-module`; emitted on every such
`require` (two requires → two warnings, the hint once). rifty: the isolate guest's stderr is empty
(`runCode`, 2026-11-24); no source in `packages/*/src` contains the text (code read for the browser hosts).
Neighbour: `module-compile-error-node-syntax-error` (the error itself). Compat ⚠️ isolate-host.md
"`require()` of an ES module" row. Owner: runtime-js module loader; trigger: a user request or the
compile-error unit's fix.
