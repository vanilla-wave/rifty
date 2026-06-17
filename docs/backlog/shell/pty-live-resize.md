---
area: shell
status: parked
title: Live terminal resize (SIGWINCH) to the running owner process mid-run
created: 2026-06-17
why: dims are sent once per exec (pty:exec carries cols/rows); a mid-run resize does not reach the running process, so a full-screen TUI / pager started in the owner shell does not reflow when the terminal panel is resized. The advertised-but-no-op pty:resize frame was DROPPED (review #3c) rather than keep lying — this item is the real feature
user_story: As a dev who resizes the terminal panel while a TUI / pager is running, I want SIGWINCH + new cols/rows to reach the running owner process so it reflows, not a frozen layout until the next command
sources: [ADR-0146, ADR-0150]
code: [apps/playground/src/glue/pty-protocol.ts, apps/playground/src/glue/pty-client.ts, apps/playground/src/workers/pty-server.ts, apps/playground/src/adapters/terminal-manager.ts]
---

## Context

Re-derived at HEAD (review #3c). `pty:resize` was a fully-wired no-op (client posted it, the
owner handler `return`ed) and nothing on the page even called `client.resize()`. It was
removed from the protocol, client, server, and `WorkspaceOwnerHandle` rather than keep
advertising an unimplemented capability. Dims remain per-exec via `pty:exec` cols/rows.

## Options or Next

- Re-introduce a `pty:resize` frame AND make the owner handler push the new dims to the
  running process (the resident shell's foreground run) + deliver SIGWINCH so the program
  reflows.
- Wire `terminal-manager` (and the terminal component's resize observer) to actually call it
  on panel resize while a run is in flight.
- Add a pty-server test pinning that a mid-run resize reaches the running process.

## Reversibility

REVERSIBLE — additive frame + handler + a test; re-adds a page→owner frame already removed.
