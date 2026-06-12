---
area: playground
status: parked
title: Terminal cannot run `node <file>` directly
created: 2026-06-12
why: node-server templates boot only via `npm run dev` routed to the registered dev-server command; a bare `node src/main.js` in the terminal is "command not found"
sources: [ADR-0130]
code: [apps/playground/src/App.tsx]
---

## Context

ADR-0130 deliberately rejected a top-level `node` terminal command: matching only the active template's entry would FAKE general `node <file>` semantics. The honest version is real: spawn a kernel worker for an arbitrary entry (runtime globals + loader + the ADR-0130 bootstrap tail), wire stdio to the terminal session, register listened ports for preview. Most plumbing now exists in `real-vite-bootstrap.ts`'s node-server branch.

## Options or Next

Generalize the node-server bootstrap into a `runNodeProgram(entry, ctx)` the shell can dispatch for `node <file>`; long-running servers keep the session busy (Ctrl-C kills the worker), run-to-completion programs exit with the worker's code. Gate: per-session worker lifecycle in the terminal manager (relates to kernel/worker-per-process-residuals).

## Reversibility

REVERSIBLE — feature addition behind the shell command registry; recorded here.
