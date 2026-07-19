---
area: runtime-js
status: draft
title: Worker string-script path contract (ERR_WORKER_PATH tail)
created: 2026-07-19
why: string Worker scripts skip Node's path validation beyond the file:-URL case
user_story: As a Node-program author, I want `new Worker(<string>)` to enforce Node's path rules (ERR_WORKER_PATH, extension rules), but today rifty validates only file:-URL strings and treats every other string as a path
blocked_by: []
sources: []
code:
  - packages/runtime-js/src/builtins/worker_threads.ts
---

## Context

Closed in PR #159: a string `file:` URL (any ASCII casing) now throws Node's
synchronous `ERR_WORKER_PATH` (parity `url/file-url-consumers`); URL objects
keep decoding through the shared codec.

Remaining tail of Node 24.16's string contract, still divergent:
- any other non-absolute, non-`./`/`../` string (bare junk, other schemes) →
  Node `ERR_WORKER_PATH`; rifty treats it as a path and fails later with a
  different error (or spawns).
- relative `./`/`../` strings: Node resolves against `process.cwd()` — verify
  rifty's same-realm and kernel spawn paths anchor identically.
- extension rule: Node throws `ERR_WORKER_UNSUPPORTED_EXTENSION` for e.g. `.ts`.
- URL objects with non-`file:` schemes: Node `ERR_WORKER_UNSUPPORTED_URL_SCHEME`;
  rifty passes `href` through as a path.

Before fixing, sweep internal spawn sites (bootstrap/recursive workers) for
reliance on the lax forms.
