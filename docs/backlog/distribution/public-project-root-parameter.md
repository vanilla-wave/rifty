---
area: distribution
status: draft
title: The public project root is one parameter of the ADR-0280 projection seam, default unchanged, and the Vite 7 starter lanes run at a second location
created: 2026-10-15
why: ADR-0280 hard-codes public `/` as the active project; seven cwd literals and the projection seam assume it, so no lane can prove a program behaves the same at another location — the minimal pattern (parameter + dual-location lanes, nothing visible changes) must land before the default flips
user_story: As a developer, I want rifty proven to run my project the same at `/` and at a non-root path, but today the root is an implicit `/` and no lane exercises anything else
epic: project-location-independence
blocked_by: []
sources: [ADR-0280, ADR-0433, ADR-0165, ADR-0278, docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md]
code: [packages/workbench/src/workbench/project-file-boundary.ts, packages/workbench/src/workers/node-entry-remote-fs.ts, packages/workbench/src/glue/pty-client.ts, packages/workbench/src/workbench/workbench-browser-owner-spawn.ts, packages/workbench/src/workbench/internal/playground-terminal-state.ts, packages/workbench/src/workbench/internal/project-runtime-acquisition.ts]
---

## Context

Finding (2026-10-15). Projection seam: `toOwnerProjectPath` /
`toProjectPath` (`project-file-boundary.ts:108-125`) and `remoteFsRoot`
(`node-entry-remote-fs.ts:14-18`) map public `/` ↔ the physical project tree;
public cwd `'/'` literals at `pty-client.ts:182,800,919`,
`workbench-browser-owner-spawn.ts:62,76`, `playground-terminal-state.ts:69`,
`project-runtime-acquisition.ts:12`; ~120 `=== '/'` prod sites to sweep (not
all root-as-project). ADR-0280 Decision states "Public `/` maps to its exact
physical tree" — this unit does not overturn it (default stays `/`): its
short ADR cites ADR-0280 and records the parameter (DEC-1 p4), keeping
ADR-0165's physical layout and ADR-0280's isolation; the synthetic `/` that
lists the project directory when the root is non-root is decided here (map
fog). The parameter is a host/SDK/template knob, never a playground UI (goal
§Decisions).

Acceptance shape expected at pickup: one parameter (carrier agent-owned:
Workbench/SDK option or template field) selects the public root; with the
default `/` nothing observable changes (existing lanes green); the Vite 7
starter build/dev+HMR/preview lanes and the Node parity runner also run with
the root set to a non-root path and pass; `pwd`/`process.cwd()`/printed
paths agree at both.

Dedup: `workbench-guest-vfs-namespace` (deleted `de26804b1`, resolved by
ADR-0280 — isolation, not location); no title/`code:`/map/declined match.

## Challenge

<!-- finding capture under a fitted goal — premise checked at the goal (README §Challenge) -->
