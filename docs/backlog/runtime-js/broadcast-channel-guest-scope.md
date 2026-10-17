---
area: runtime-js
status: draft
title: Guest BroadcastChannel reaches only its own Node process, as in Node
created: 2026-10-16
why: Node's BroadcastChannel spans the worker_threads of one process; the guest gets Chromium's, which spans every same-origin context — other rifty processes, other projects' realms and rifty internals that use BroadcastChannel (ADR-0180 per-port channels)
user_story: As a Node program using `new BroadcastChannel('jobs')` between its worker_threads, I want messages only from my own process as in Node, but today any same-origin realm on the page can post to and read that channel
blocked_by: []
sources: [ADR-0529, ADR-0180]
code: [packages/runtime-js/src/builtins/host-async-keepalive.ts]
---

## Context

Found 2026-10-16 while adding the ADR-0529 `BroadcastChannel` hold: the guest
global is the native one (only lifetime and Node's `ref()`/`unref()` are
wrapped). Two `node` processes in one Workbench, or a forked child, share a
channel name that Node would keep apart; a guest name equal to an internal
channel name would cross into rifty infrastructure. Not yet probed — the first
step is a parity row (two processes, same channel name: Node delivers nothing
across processes).

## Challenge

challenge: 2026-10-16 — not run (draft)
