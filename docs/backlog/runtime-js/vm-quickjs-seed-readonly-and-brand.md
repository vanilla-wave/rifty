---
area: runtime-js
status: draft
title: QuickJS vm context seeded with a read-only property throws after the run; seeded objects lose their `Symbol.toStringTag`
created: 2026-11-17
why: on the default COI vm engine `vm.runInNewContext(code, { p: require('node:process') })` runs the code, then throws on write-back (result lost, side effects kept), and a seeded host object's brand reads `[object Object]`
sources: [docs/adr/runtime-js/0142-node-vm-dual-engine-quickjs-real-realm-default-hardened-rewrite-loud-opt-in.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/vm/membrane.ts, packages/runtime-js/src/builtins/vm/engine-config.ts]
---

## Context

REV-12 discovery of the process brand fix (branch `t3/w1-process-tag`).
Scratch parity cases (default mode → QuickJS engine, `engine-config.ts`;
the no-COI toolchain realm uses `rewrite`), Node v24.16.0 vs rifty
(`ro` = an object with a non-writable enumerable `name`):

```
vm.runInNewContext('Object.prototype.toString.call(p)', { p: require('node:process') })
  Node "[object process]" · rifty TypeError: Cannot assign to read only property 'name' of object '#<Object>'
vm.runInNewContext('1', { o: ro })                → Node 1 · rifty the same TypeError
vm.runInNewContext('1', { o: { inner: ro } })     → Node 1 · rifty the same TypeError
vm.runInNewContext('f(); 2', { f: () => n++, o: { inner: ro } })
  Node 2, n = 1 · rifty TypeError, n = 1 (the code ran; its result is lost)
vm.runInNewContext('Object.prototype.toString.call(o)', { o: { [Symbol.toStringTag]: 'x', a: 1 } })
  Node "[object x]" · rifty "[object Object]"
```

Code reading: post-run reconciliation `#sweepInto` (`membrane.ts`) assigns
every own enumerable guest key back onto the host object, including unchanged
non-writable ones (`process.release.name`, ADR-0345) → strict-mode TypeError.
`#populateSeed` copies `Object.keys` only, so symbol-keyed brands never reach
the guest copy. Not covered by `runtime-js/vm-test-pinning` (its caveats are
mutation visibility, not write-back of read-only keys or brands). Compat ❌:
`docs/public/compat/modules.md` vm membrane gaps.

## Next

Owner runtime-js. Trigger: a program seeding `process` (or any object with a
read-only data property) into a vm context, or reading a seeded object's brand.
Parity first under QuickJS: the calls above. May split at pickup: the
read-only write-back throw and the brand loss are separate behaviors.
