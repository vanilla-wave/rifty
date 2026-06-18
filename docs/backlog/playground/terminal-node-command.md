---
area: playground
status: done
title: Terminal cannot run `node <file>` directly
created: 2026-06-12
why: node-server templates boot only via `npm run dev` routed to the registered dev-server command; a bare `node src/main.js` in the terminal is "command not found"
user_story: As a developer in the playground terminal, I want to run `node src/main.js` on any entry file, but today only `npm run dev` for the active template boots a worker — a bare `node <file>` is "command not found".
sources: [ADR-0130]
code: [apps/playground/src/App.tsx]
---

## Resolution (2026-06-18 — ADR-0154)

DONE. `node <file>` runs an arbitrary entry as a supervised child of the workspace owner (the
ADR-0137 `runNodeEntry` seam, NOT the template dev-server bootstrap — the frame below was written
pre-P6 and is stale: a fresh kernel worker = the two-owners ENOENT P6 killed). Run-to-completion
drains+exits (ADR-0152); a `listen()` keeps the child alive (`serve:true`) + registers the port for
preview; multiple servers (+ `npm run dev`) surface through a `pty:preview` registry frame + a
preview-panel port switcher. Loud gaps (interactive stdin, background `&`, bare-node `node:sqlite`,
cross-realm loopback) are backlogged, not silent. See `docs/adr/playground/0154-…md`, compat
`docs/public/compat/process.md`, `tests/e2e/node-command.spec.ts`.

## Context (original — frame stale, see Resolution)

ADR-0130 deliberately rejected a top-level `node` terminal command: matching only the active template's entry would FAKE general `node <file>` semantics. The honest version is real: spawn a kernel worker for an arbitrary entry (runtime globals + loader + the ADR-0130 bootstrap tail), wire stdio to the terminal session, register listened ports for preview. Most plumbing now exists in `real-vite-bootstrap.ts`'s node-server branch.

## Options or Next

Generalize the node-server bootstrap into a `runNodeProgram(entry, ctx)` the shell can dispatch for `node <file>`; long-running servers keep the session busy (Ctrl-C kills the worker), run-to-completion programs exit with the worker's code. Gate: per-session worker lifecycle in the terminal manager (relates to kernel/worker-per-process-residuals).

## Reversibility

REVERSIBLE — feature addition behind the shell command registry; recorded here.
