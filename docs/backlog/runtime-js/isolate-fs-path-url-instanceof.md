---
area: runtime-js
status: draft
title: "An fs path that is neither a string, bytes nor a URL throws Node's ERR_INVALID_ARG_TYPE"
created: 2026-11-24
why: Browser hosts throw a code-less `TypeError('fs path must be string, Buffer, or URL')`; the isolate guest throws `TypeError: Right-hand side of 'instanceof' is not an object` (rifty's `p instanceof URLConstructor` with `URL` a ceiling global), Node `TypeError [ERR_INVALID_ARG_TYPE]`
sources: [docs/backlog/runtime-js/isolate-require-esm-syntax-gaps.md]
code: [packages/runtime-js/src/builtins/fs-path.ts, packages/runtime-js/src/internal/posix-file-url.ts]
---

## Context

Found 2026-11-24 while measuring unit `runtime-js/isolate-require-esm-syntax-gaps`; same root
(`URLConstructor = globalThis.URL` captured at runtime-js load, before the guest installs its
ceiling `URL`, `web-shim.ts`), other path. `runCode("try{require('fs').readFileSync({})}catch(e){console.log(e.code,e.message)}")`
→ `undefined Right-hand side of 'instanceof' is not an object` (`fs-path.ts` `pathText`, line 33).
Node v24.16.0: `ERR_INVALID_ARG_TYPE The "path" argument must be of type string or an instance of Buffer or URL. Received an instance of Object`.
Browser hosts (code read, `fs-path.ts:35`): a bare `TypeError('fs path must be string, Buffer, or URL')`, no `code` — wrong on every host, the isolate one leaking the `instanceof` first. Fault class `sibling-drift` (isolate) + Node-shape gap (all). Not `path-arg-type-validation` (`node:path` only). Owner: runtime-js with isolate-guest. Trigger: an agent run hitting it,
or the isolate ESM ❌ lifting (`URL` in the guest). No compat row yet: to add with the fix.
