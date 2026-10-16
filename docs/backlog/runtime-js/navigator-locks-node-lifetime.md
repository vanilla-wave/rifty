---
area: runtime-js
status: draft
title: navigator.locks requests keep Node's process lifetime in the guest
created: 2026-10-16
why: Node 24 has a global `navigator.locks`; in the child realm it is Chromium's, whose acquisition and release are host IPC rifty cannot hold exactly, so a program whose last work is a lock request can exit before it settles (ADR-0529 §4 declared gap)
user_story: As a Node program whose last work is `navigator.locks.request('x', cb).then(print)`, I want it to print as in Node 24, but today nothing holds the realm while Chromium's lock manager answers
blocked_by: []
sources: [ADR-0529, ADR-0152]
code: [packages/runtime-js/src/builtins/host-async-keepalive.ts]
---

## Context

Node 24.16.0 probes (2026-10-16): `request('a', () => 'held').then(print)` →
prints, exit 0; a request whose callback never settles → exit 0 at once; a
request queued behind a never-released lock → exit 0 (`queued` only). So Node
holds neither the callback's work nor contention. In Chromium the request and
the release are IPC to the browser's lock manager; a hold from `request()` to
the callback would keep a contended request alive to the drain cap (Node exits
0), no hold races the drain (passes on timing today). Exact options to weigh at
refine: an in-realm JS LockManager matching Node's in-process semantics (cross
`worker_threads` scope?), or a loud ceiling. Compat ❌ row in
`docs/public/compat/process.md`.

## Challenge

challenge: 2026-10-16 — not run (draft)
