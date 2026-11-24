---
area: runtime-js
status: draft
title: "An fs path that is neither a string, bytes nor a URL throws Node's ERR_INVALID_ARG_TYPE"
created: 2026-11-24
why: rifty's browser hosts throw a code-less `TypeError('fs path must be string, Buffer, or URL')` (the isolate guest `Right-hand side of 'instanceof' is not an object`); Node `TypeError [ERR_INVALID_ARG_TYPE]` naming the argument
sources: [docs/backlog/runtime-js/isolate-require-esm-syntax-gaps.md]
code: [packages/runtime-js/src/builtins/fs-path.ts]
---

## Context

Found 2026-11-24 measuring unit `runtime-js/isolate-require-esm-syntax-gaps` (the isolate guest's own symptom, `Right-hand side of 'instanceof' is not an object`, is
`runtime-js/isolate-web-globals-captured-at-load`).
`require('fs').readFileSync({})`: Node v24.16.0 → `TypeError` `ERR_INVALID_ARG_TYPE` `The "path"
argument must be of type string or an instance of Buffer or URL. Received an instance of Object`;
rifty's browser hosts (`fs-path.ts` `pathText`, code read) → `TypeError: fs path must be string, Buffer, or URL`, no `code`. Node's argument name
differs per call (`oldPath`/`newPath`, `src`/`dest`, `target`, `existingPath`), so `pathText` alone
does not know it. Not `path-arg-type-validation` (`node:path` only). Owner: runtime-js fs. Trigger:
a user request or a package branching on the code. No compat row yet.
