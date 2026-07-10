---
area: playground
status: draft
title: Structured install and runtime diagnostics from the workspace owner
created: 2026-07-09
why: The owner already knows real run exit/error and npm progress/provenance, but the page receives incomplete outcomes or rendered terminal text, leaving the diagnostics UI no honest structured source.
user_story: As a developer whose install or command failed, I want the diagnostic linked to the exact command, cwd, run, stage, and real exit/error, but today that context is scattered across PTY state, history, stderr, and console.
epic: actionable-ide-diagnostics
blocked_by: [playground/diagnostics-hub]
sources: [M11, ADR-0146, ADR-0182, ADR-0188]
code: [apps/playground/src/glue/pty-protocol.ts, apps/playground/src/glue/pty-client.ts, apps/playground/src/workers/pty-server.ts, apps/playground/src/glue/npm-shell-command.ts, packages/npm-client/src/installer.ts]
---

## Context

Carry owner-authoritative execution outcomes into the diagnostics hub: app run id/rid, command, cwd, submit/finish wall time, real exit versus transport loss, structured error code/message, and install facts already exposed by `onPackage`, `onSubstitution`, and final `InstallResult.source`. Link records to the terminal command block; keep stdout/stderr byte-for-byte and do not parse it for state.

Do not invent PID/job identity, CPU time, npm percentages, Eddy provenance before final source, or exit codes for an owner disconnect. `PtyExit.error` currently dies in the page client; transport loss needs its own outcome rather than synthetic process failure.

## Reversibility

New owner→page structured execution mechanism is a genuine cross-realm contract → ADR before `ready`. No kernel/public SDK surface is implied.
