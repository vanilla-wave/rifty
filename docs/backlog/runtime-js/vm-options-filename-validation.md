---
area: runtime-js
status: draft
title: "`vm` rejects a non-string `options.filename` with Node's `ERR_INVALID_ARG_TYPE`"
created: 2026-09-24
why: Node validates `options.filename` first (before offsets); rifty runs the script under `String(filename)` or throws a bare `TypeError` for a null-prototype object
sources: [docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md, docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-final-green.json, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/index.ts, packages/runtime-js/src/builtins/vm/script-offsets.ts]
---

## Context

REV-12 discovery of `runtime-js/reference/vm-run-in-this-context-offsets-evidence.md`
(vitest-run-in-browser item 10); pre-existing. Node v24.16.0 (evidence §P3,
§P9): `{filename: 1}` → `TypeError ERR_INVALID_ARG_TYPE The
"options.filename" property must be of type string. Received type number (1)`,
checked before `lineOffset`/`columnOffset`. `normalizeOptions`
(`vm/index.ts`) never checks it; `hostScriptSourceURL` uses
`String(filename)`.

Probe 2026-09-24 (scratch CJS parity case, `tools/node-parity-runner`
`runInNode`/`runInRifty`, rifty in the Node host @ `8c8993649`):
`vm.runInThisContext('1', { filename: f })` for `f` = `1`, `{}`,
`Object.create(null)`:

```
node v24.16.0: ERR_INVALID_ARG_TYPE … Received type number (1)
               ERR_INVALID_ARG_TYPE … Received an instance of Object
               ERR_INVALID_ARG_TYPE … Received [Object: null prototype] {}
rifty:         no throw (number) / no throw (object) /
               TypeError (no code) Cannot convert object to primitive value
```

Same helper gap: `describeInvalidType` renders a null-prototype object as
`an instance of Object` in rifty's other vm `ERR_INVALID_ARG_TYPE` messages
(Node: `[Object: null prototype] {}`). Compat ❌
`docs/public/compat/modules.md` "`options.filename` type validation"
(added with this draft).

## Next

Owner runtime-js (vm). Trigger: a consumer passing a computed filename, or
the next vm argument-validation unit. Parity first: the three rows above on
`runInThisContext`, `new Script`, `runInContext`, `runInNewContext`,
`compileFunction`, plus Node's order (`filename` before offsets).
