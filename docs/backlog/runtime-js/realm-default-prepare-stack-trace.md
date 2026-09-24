---
area: runtime-js
status: draft
title: Node realms start with Node 24's default `Error.prepareStackTrace`, not Chromium's `undefined`
created: 2026-09-24
why: Node 24 installs `ErrorPrepareStackTrace` as a writable data property in every main/worker realm; Chromium has none, so code that delegates to or feature-detects the default hook takes another branch in rifty
sources: [docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md, docs/adr/runtime-js/0450-project-vm-script-offsets-through-one-owned-stack-hook.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/script-offsets.ts]
---

## Context

REV-12 discovery of `runtime-js/vm-run-in-this-context-offsets`
(vitest-run-in-browser item 10; evidence §Discovered 4, unit Out of scope
"route to backlog at land", not filed then); pre-existing, realm-wide (not
vm-specific). Re-run 2026-09-24:

```
$ node -e "const d=Object.getOwnPropertyDescriptor(Error,'prepareStackTrace'); console.log(process.version, typeof d.value, d.value.name, d.writable, d.enumerable, d.configurable)"
v24.16.0 function ErrorPrepareStackTrace true false true
(worker_threads Worker, eval) worker function ErrorPrepareStackTrace
$ (Playwright chromium page) typeof Error.prepareStackTrace, own?
148.0.7778.96 undefined own false
```

The parity runner cannot show it (rifty runs in the Node host, whose realm
has Node's default). After an offset script ran, ADR-0450's owner accessor
answers a default — a separate compat ❌ row.

## Next

Owner runtime-js. Trigger: a claimed consumer that reads or calls the
default hook before installing its own (source-map support chaining), or
the next realm-bootstrap unit. Parity first in Chromium browser-unit
against the live Node oracle: descriptor shape, `name`, and output of
`Error.prepareStackTrace(err, callSites)` vs the native `stack`.
