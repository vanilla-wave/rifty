---
area: runtime-js
status: draft
title: "`node:vm` context-argument errors lack Node's `ERR_INVALID_ARG_TYPE` code; a primitive to `runInNewContext`/`createContext` throws the wrong error"
created: 2026-11-17
why: callers branching on `err.code === 'ERR_INVALID_ARG_TYPE'` miss rifty's vm argument errors, and two entry points leak an internal `Object.defineProperty` TypeError
sources: [docs/public/compat/modules.md, docs/adr/runtime-js/0142-node-vm-dual-engine-quickjs-real-realm-default-hardened-rewrite-loud-opt-in.md]
code: [packages/runtime-js/src/builtins/vm/index.ts]
---

## Context

REV-12 discovery during the process brand fix's RDY-6 check (branch
`t3/w1-process-tag`). Scratch parity case (default mode), Node v24.16.0 vs rifty:

```
vm.runInContext('1', 1)     Node ERR_INVALID_ARG_TYPE 'The "object" argument must be of type object. Received type number (1)'
                            rifty same message, code undefined
vm.runInContext('1', {})    Node ERR_INVALID_ARG_TYPE 'The "contextifiedObject" argument must be an vm.Context. Received an instance of Object'
                            rifty same message, code undefined
vm.runInNewContext('1', 1)  Node ERR_INVALID_ARG_TYPE 'The "object" argument must be of type object. Received type number (1)'
                            rifty TypeError 'Object.defineProperty called on non-object', no code
vm.createContext(1)         Node as runInNewContext · rifty as runInNewContext
```

The messages come from `assertContextified` (`vm/index.ts`), which throws a
plain `TypeError`. `docs/public/compat/modules.md` claimed Node's exact error;
corrected to ❌ in the same change.

## Next

Owner runtime-js. Trigger: a caller checking `code` on vm argument errors, or
passing a primitive to `createContext`/`runInNewContext`. Parity first: the
four calls above plus the `Script#runIn*Context` twins, `code` + message.
