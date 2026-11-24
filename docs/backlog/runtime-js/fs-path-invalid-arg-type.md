---
area: runtime-js
status: draft
title: "An fs path that is neither a string, bytes nor a URL throws Node's ERR_INVALID_ARG_TYPE"
created: 2026-11-24
why: rifty throws a code-less `TypeError('fs path must be string, Buffer, or URL')` on every host; Node `TypeError [ERR_INVALID_ARG_TYPE]` naming the argument
sources: [docs/backlog/runtime-js/isolate-require-esm-syntax-gaps.md]
code: [packages/runtime-js/src/builtins/fs-path.ts]
---

## Context

Found 2026-11-24 measuring unit `runtime-js/isolate-require-esm-syntax-gaps` (first as an isolate-only
`instanceof URLConstructor` leak; that half closed by PR #440's late-`URL` forwarder, round 2).
`require('fs').readFileSync({})`: Node v24.16.0 → `TypeError` `ERR_INVALID_ARG_TYPE` `The "path"
argument must be of type string or an instance of Buffer or URL. Received an instance of Object`;
rifty, every host (`fs-path.ts` `pathText`; isolate measured, `packages/isolate-host/tests/require-esm.test.ts`
pins it) → `TypeError: fs path must be string, Buffer, or URL`, no `code`. Node's argument name
differs per call (`oldPath`/`newPath`, `src`/`dest`, `target`, `existingPath`), so `pathText` alone
does not know it. Not `path-arg-type-validation` (`node:path` only). Owner: runtime-js fs. Trigger:
a user request or a package branching on the code. No compat row yet.
