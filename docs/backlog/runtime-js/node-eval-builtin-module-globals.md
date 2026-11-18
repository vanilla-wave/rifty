---
area: runtime-js
status: draft
title: "`node -e`/`-p` exposes Node's builtin modules as globals"
created: 2026-11-18
why: Node's eval entry defines every builtin module as a lazy global (`node -e "fs.readFileSync(…)"` works); rifty's `-e` defines none, so such one-liners throw `ReferenceError`, and Node's late `module` (the builtin) has no rifty analogue
sources: [docs/public/compat/process.md, tests/no-coi/no-coi-shared-realm.spec.ts]
code: [packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/module-loader/loader.ts]
---

## Context

PR #408 outside finding 2. Node v24.16.0
`lib/internal/main/eval_string.js` calls `addBuiltinLibsToObject(globalThis,
'<eval>')` before `evalScript`: an accessor global per builtin name (live:
43 `builtinModules` names without `/`/`_` read as accessor globals under
`node -p`, `process` included; own get/set accessor globals: 44 under `-p`, 3
in a file entry). Live:
`node -e "console.log(typeof fs, typeof path)"` → `object object`. Rifty no-COI
project command, same line → `undefined undefined` (PR #408 probe, exit 0).
`runScriptInContext` then restores `globalThis.module = origModule` (the
`module` builtin) after the synchronous part, so a timer or `'exit'` listener
reads `typeof module` `'function'`; rifty reads the eval module `'object'` —
pinned as a declared residual in `no-coi-shared-realm.spec.ts` (`eval-late`).
COI shares `runNodeEntry`'s eval branch (code read, unmeasured).

## Next

Owner runtime-js. A parity case for `node -e` builtin globals (read, assign,
`delete`, the `module` restore) against live Node on both hosts before an
implementation; in no-COI the new globals join `captureNodeProcessGlobals`'s
restore (the realm is shared). Include Node's `crypto` identifier special case
in `eval_string.js` (the code is wrapped with `node:crypto` when it names
`crypto`).
