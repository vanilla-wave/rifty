---
area: runtime-js
status: draft
title: vm (QuickJS engine) keeps a leading U+FEFF in strings and keys marshalled to the host
created: 2026-11-17
why: values and property names crossing the QuickJS membrane lose a leading U+FEFF, so `vm.runInNewContext("'﻿A'")` returns "A"
sources: [docs/adr/runtime-js/0142-node-vm-dual-engine-quickjs-real-realm-default-hardened-rewrite-loud-opt-in.md]
code: [packages/runtime-js/src/builtins/vm/membrane.ts, packages/runtime-js/src/builtins/vm/quickjs-engine.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17, sweep critic).
Probe (scratch parity case, in-process runner, Node v24.16.0 vs rifty's
default QuickJS engine): `vm.runInNewContext("'\\ufeffA'")` → Node `feff 41`,
rifty `41`; `globalThis['\\ufeffk'] = 1` in a context → Node key `feff 6b`,
rifty `6b`. Mid-string U+FEFF survives. Cause (sweep, code read): the
`@jitl/quickjs-wasmfile-release-sync@0.32.0` emscripten `UTF8ToString` uses a
default `TextDecoder`, reached from the membrane string reads
(`membrane.ts` ~:556, property names ~:975/:1098/:1390). The bundle is
third-party bytes: a fix reads the string bytes in the membrane, not a patch.
Fault: corrupt-input at the engine → host marshal boundary.
Dedup: vm-* items (display errors, frame naming, options, pinning, unwired
seams) cover none of string marshalling.

## Next

Owner runtime-js; trigger: a claimed program evaluating BOM-led strings or
keys in `vm` contexts (template engines, CSV in sandboxes). RED first: the two
probe lines as a `vm/string-leading-bom` parity case.
