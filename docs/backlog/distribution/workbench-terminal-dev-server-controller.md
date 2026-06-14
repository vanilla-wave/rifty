---
area: distribution
status: parked
title: Workbench terminal + dev-server lifecycle controller
created: 2026-06-14
why: EPIC C exposes `createTerminalManager`, `createRuntimeSession`, `createNpmShellCommand`, and `RuntimeSession.ready`, but consumers still have to hand-compose the visible terminal command, dev-server lifecycle state, restart/stop behavior, and log readiness wiring that the playground owns in `App.tsx`.
user_story: As a non-Solid host using `@riftydev/workbench`, I want one headless controller that wires a terminal session to the project runtime lifecycle, so "run dev server", "stop", "restart", terminal output, `session.ready`, and preview URL updates do not require copying playground orchestration code.
sources: [ADR-0139, EPIC C, DD-3]
---
## Context
`@riftydev/workbench` now owns the primitives: project Worker runtime, terminal
session manager, terminal persistence, npm shell command, preview binding, and
runtime session readiness. The remaining friction is orchestration locality:
the playground still manually composes a visible terminal command around
`createRuntimeSession`, waits for readiness, tracks `starting/running/stopped`,
forwards logs, and owns restart/stop cleanup.

This is not part of the initial extraction. It is a higher-level convenience
interface over the extracted primitives.

## Options / Next
- Add `createWorkbenchDevServerController(...)` in `@riftydev/workbench`.
- Inputs: `bootstrapWorkerUrl`, optional `template/setup/slug`, terminal manager
  or writer, and lifecycle callbacks.
- Outputs: current `RuntimeSession`, preview URL, status, run/stop/restart
  methods, and a terminal command adapter suitable for `createTerminalManager`.
- Preserve escape hatches: advanced hosts can still compose primitives directly.
- Cover with tests for readiness, restart cleanup, stop-before-ready, and log
  forwarding.

## Reversibility
IRREVERSIBLE if exported publicly. Promote to ADR before implementing because it
adds a new convenience API shape over existing workbench primitives.
