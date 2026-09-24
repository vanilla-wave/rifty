---
area: runtime-js
status: draft
title: A module's own `//# sourceURL=` names its frames, as in Node, instead of rifty's appended loader `sourceURL`
created: 2026-09-24
why: rifty's loaders append `//# sourceURL=<id>` after guest code, and V8's last valid comment wins, so a guest-declared name (bundler output, generated code) is silently replaced by the module path
sources: [docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md, docs/backlog/runtime-js/vm-run-in-this-context-offsets.md]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/esm-job-preparation.ts, packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/builtins/child_process-exec.ts]
---

## Context

REV-12 discovery of `runtime-js/vm-run-in-this-context-offsets`
(vitest-run-in-browser item 10; evidence §Own sourceURL "Pre-existing
sibling", unit Out of scope "routed at land", not filed then). ADR-0450
honours an own `sourceURL` only for host-realm vm scripts. Sites appending
their own after guest code: `cjs.ts` `compileCjsSource`,
`esm-job-preparation.ts`, `loader.ts` `[eval]`, `worker_threads.ts`,
`child_process-exec.ts`, the vm sandbox engines.

Probe 2026-09-24 (scratch CJS parity case, `tools/node-parity-runner`
`runInNode`/`runInRifty`, rifty in the Node host @ `8c8993649`): `lib.js` =
`module.exports = function f() { return new Error('e').stack.split('\n')[1]; };
//# sourceURL=/virtual/own.js`, required from the entry:

```
node v24.16.0: cjs frame names own sourceURL: true
rifty:         cjs frame names own sourceURL: false
```

Only the CJS site is measured; the others are code reading. Compat ⚠️
`docs/public/compat/modules.md` "Module code's own `//# sourceURL=`"
(added with this draft).

## Next

Owner runtime-js (module loader). Trigger: a consumer whose stack
filtering or source mapping keys on a self-declared `sourceURL`, or the
next loader stack unit. Parity first per site (CJS, ESM, `[eval]`,
worker, same-realm child), reusing ADR-0450's comment grammar (last valid
comment wins, evidence §Own sourceURL).
