---
area: runtime-js
status: draft
title: node -e unhandled rejection fails at the next drain check, not at the microtask checkpoint
created: 2026-11-18
why: Node exits on an unhandled rejection right after the microtask queue drains; rifty's eval lifecycle lets other pending tasks run first, and loses a rejection raised inside an 'exit' listener.
sources: [docs/public/compat/isolate-host.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

Node v24.16.0, `node -e "const p = Promise.reject(new Error('x')); setTimeout(() => p.catch(() => console.log('late-caught')), 10)"`
→ stdout empty, `[eval]` diagnostic, status 1. rifty (isolate host, ADR-0557;
the eval drain lifecycle is shared with the browser `node -e` path) prints
`late-caught` before the same diagnostic and status 1. Separately
`node -e "process.on('exit', () => { Promise.reject(new Error('x')) })"` →
Node status 1 with a diagnostic; rifty status 0, nothing printed (found by the
isolate-host Final+GREEN review). Open: whether the rejection should
terminate before the next macrotask in every realm (kernel child, no-COI,
isolate) — `awaitDrain` owner.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
