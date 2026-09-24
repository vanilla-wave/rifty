---
area: runtime-js
status: draft
title: Host-realm `vm` script frames name the script as Node does (`evalmachine.<anonymous>`, any filename, non-eval CallSites)
created: 2026-09-24
why: rifty evaluates host-realm vm scripts as eval with an appended `sourceURL`, so frames are eval-shaped, a missing or non-`sourceURL` filename renders as a nested eval origin leaking rifty's `vm/index.ts` path, and eval origins show the encoded offset identity
sources: [docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md, docs/adr/runtime-js/0450-project-vm-script-offsets-through-one-owned-stack-hook.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/index.ts, packages/runtime-js/src/builtins/vm/script-offsets.ts]
---

## Context

REV-12 discoveries of `runtime-js/vm-run-in-this-context-offsets`
(vitest-run-in-browser item 10; unit Out of scope "route to backlog at
land", not filed then). One mechanism: `runScriptInThisContext` runs
`code + '\n//# sourceURL=' + name` through a global eval; with zero offsets
and no usable name it appends nothing (`hostScriptSourceURL`).

Evidence §Discovered 1/3, §IMPLEMENT probes (Node v24.16.0) and probe
2026-09-24 (scratch CJS parity case, `tools/node-parity-runner`
`runInNode`/`runInRifty`, rifty in the Node host @ `8c8993649`; first
`at` line of `vm.runInThisContext('throw new Error("x")', opts)`, rifty
paths shortened):

```
opts                      node v24.16.0                     rifty
none                      at evalmachine.<anonymous>:1:7    at eval (eval at <anonymous> (eval at <anonymous> (file:…/vm/index.ts…)), <anonymous>:1:7)
{filename:'/virtual/a.js'} at /virtual/a.js:1:7             at eval (/virtual/a.js:1:7)
{filename:'/virtual/a b.js'} at /virtual/a b.js:1:7         (as "none")
{filename:' '}            at  :1:7                          (as "none")
```

Also recorded (evidence §Discovered 1, §IMPLEMENT; compat ❌ rows): CallSite
`isEval()` true, `getFileName()` undefined, `getEvalOrigin()` = filename,
top-level `getFunctionName()` `eval` (Node false / filename / undefined /
null); `eval`/`new Function` inside an offset script show the encoded
identity `rifty-vm://…` without position as eval origin (Node
`eval at g (/virtual/nested.js:1:24)`, ADR-0450 §Divergences).

## Next

Owner runtime-js (vm). Trigger: a consumer parsing vm frames (source-map
support, test-runner stack filters) or the next vm stack unit. Parity
first: the table above in Node host and Chromium browser-unit. Pickup
decides whether one carrier (a non-eval compile primitive, or projection
through the ADR-0450 owner) covers all rows; split if not.
