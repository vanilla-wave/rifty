---
area: runtime-js
status: draft
title: Spec-less default process writes stdout bytes, not console.log lines
created: 2026-11-17
why: the default `riftyProcess` (no KernelProcessSpec) turns each stdout/stderr write into a console.log call, adding a newline per write
sources: [tools/node-parity-runner/cases/process/default-realm-stdout-bom.case.ts]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/repl/console.ts, packages/runtime-js/src/worker-entry.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17). With no kernel
spec, `NodeProcess` (`process.ts` constructor else-branch) builds stdout and
stderr writers as `console.log(bytesToString(bytes, 'utf8'))` /
`console.error(…)`. That realm is the public `@riftydev/runtime-js/worker`
(`worker-entry.ts` `installProcessGlobals()` + `installConsole(sink)`), whose
console appends `\n` per call (`repl/console.ts` `stdoutWrite`).

Probe (scratch parity case, in-process runner, Node v24.16.0):
`p = require('node:process'); p.stdout.write('w1'); p.stdout.write(Buffer.from([0xef,0xbb,0xbf,0x42,0x0a]))`
→ Node stdout bytes `w 1 357 273 277 B \n` (`od -c`); rifty (runner-normalised,
trailing newlines stripped) `w1\nB` before the BOM fix, `w1\n\ufeffB` after it —
raw output adds `\n` per write. Each write also goes through console formatting.
Dedup: git grep riftyProcess / console sink / stdout newline over
docs/backlog — no match.
Fault: corrupt-input (extra bytes) at the default-realm stdio sink.

## Next

Owner runtime-js; trigger: an embedder or program writing partial lines to
`process.stdout` in the runtime worker realm. RED first: the probe above.
