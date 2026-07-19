---
area: runtime-js
status: draft
title: Worker string file: URL must throw ERR_WORKER_PATH
created: 2026-07-19
why: normalizeWorkerScript grants URL semantics to strings Node rejects
user_story: As a Node-program author, I want `new Worker('file:///…')` (string) to throw ERR_WORKER_PATH like Node, but today rifty silently converts the string to a path and spawns it
blocked_by: []
sources: []
code:
  - packages/runtime-js/src/builtins/worker_threads.ts
---

## Context

Node 24.16: `new Worker(script)` with a STRING accepts only an absolute path or
`./`/`../`-relative path; `'file:///abs/w.js'` (any ASCII casing) throws
`ERR_WORKER_PATH`. URL semantics require a `URL` object (that side is already
parity-pinned: `url/file-url-consumers` covers encoded-separator rejection).
rifty's `normalizeWorkerScript` decodes `file://` strings into paths and spawns
— URL semantics granted where Node rejects, same axis as the resolver esm-gate
(parity `modules/require-url-specifier-strings`), different boundary.

Before fixing, sweep internal spawn sites: bootstrap/recursive-worker paths may
feed `file://` strings through the same normalizer and must switch to `URL`
objects or plain paths first.
